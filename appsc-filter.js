
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// ========================================
// APPSC OFFICIAL PAGES
// ========================================

const PAGES = [
    {
        name: "APPSC Notifications",
        url: "https://portal-psc.ap.gov.in/HomePages/Notifications"
    },
    {
        name: "APPSC Recruitment Notifications",
        url: "https://portal-psc.ap.gov.in/HomePages/RecruitmentNotifications"
    }
];

// Only official APPSC domains
const ALLOWED_HOSTS = [
    "portal-psc.ap.gov.in",
    "psc.ap.gov.in"
];

const PENDING_FILE = path.join(__dirname, "pending-jobs.json");

// Current Indian year + next 2 years
const CURRENT_YEAR = Number(
    new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric"
    }).format(new Date())
);

const YEARS = [
    CURRENT_YEAR,
    CURRENT_YEAR + 1,
    CURRENT_YEAR + 2
];

const MAX_RETRIES = 3;
const TIMEOUT_SECONDS = 30;

// ========================================
// WAIT FUNCTION
// ========================================

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================================
// SECURE APPSC WEBSITE FETCH
// ========================================

// Uses Windows curl.exe.
// SSL certificate verification remains enabled.
function fetchAPPSCWebsite(page) {
    return new Promise((resolve, reject) => {
        const args = [
            "-fL",
            "--silent",
            "--show-error",
            "--max-time",
            String(TIMEOUT_SECONDS),
            "-A",
            "Mozilla/5.0",
            "-H",
            "Accept: text/html,application/xhtml+xml",
            "--write-out",
            "\nDURGA_META:%{http_code}|%{url_effective}",
            page.url
        ];

        execFile(
            "curl.exe",
            args,
            {
                encoding: "utf8",
                maxBuffer: 10 * 1024 * 1024,
                windowsHide: true
            },
            (error, stdout, stderr) => {
                if (error) {
                    console.error("Curl error:", error.message);

                    if (stderr) {
                        console.error("Details:", stderr);
                    }

                    return reject(error);
                }

                const marker = "\nDURGA_META:";
                const markerIndex = stdout.lastIndexOf(marker);

                if (markerIndex === -1) {
                    return reject(
                        new Error("HTTP response metadata not found.")
                    );
                }

                const html = stdout.substring(0, markerIndex);

                const metadata = stdout
                    .substring(markerIndex + marker.length)
                    .trim();

                const [status, finalURL] = metadata.split("|");

                if (status !== "200") {
                    return reject(
                        new Error(`APPSC returned HTTP ${status}`)
                    );
                }

                try {
                    const parsedURL = new URL(finalURL);

                    if (
                        parsedURL.protocol !== "https:" ||
                        !ALLOWED_HOSTS.includes(parsedURL.hostname)
                    ) {
                        return reject(
                            new Error("Unexpected redirect destination.")
                        );
                    }
                } catch {
                    return reject(
                        new Error("Invalid final response URL.")
                    );
                }

                if (!html.trim()) {
                    return reject(
                        new Error("APPSC returned an empty HTML page.")
                    );
                }

                console.log("HTTPS connection successful.");
                console.log("HTTP status:", status);

                console.log(
                    "HTML bytes:",
                    Buffer.byteLength(html, "utf8")
                );

                resolve(html);
            }
        );
    });
}

// ========================================
// RETRY CONNECTION
// ========================================

async function fetchWithRetry(page) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(
                `Connecting to ${page.name}... ${attempt}/${MAX_RETRIES}`
            );

            return await fetchAPPSCWebsite(page);

        } catch (error) {
            lastError = error;

            console.error(
                `Attempt ${attempt} failed:`,
                error.message
            );

            if (attempt < MAX_RETRIES) {
                console.log("Retrying in 5 seconds...");
                await wait(5000);
            }
        }
    }

    throw new Error(
        `Unable to connect to ${page.name}. ` +
        `Last error: ${lastError?.message || "Unknown error"}`
    );
}

// ========================================
// LOAD EXISTING PENDING JOBS
// ========================================

function loadPendingJobs() {
    if (!fs.existsSync(PENDING_FILE)) {
        return [];
    }

    const data = fs.readFileSync(PENDING_FILE, "utf8");

    if (!data.trim()) {
        return [];
    }

    const jobs = JSON.parse(data);

    if (!Array.isArray(jobs)) {
        throw new Error(
            "pending-jobs.json must contain a JSON array."
        );
    }

    return jobs;
}

// ========================================
// EXTRACT NOTIFICATION NUMBER
// Example: 37/2026
// ========================================

function getNotificationNumber(text) {
    const match = String(text || "").match(
        /notification\s*(?:no\.?|number)\s*[:.-]?\s*(\d{1,3})\s*\/\s*(20\d{2})/i
    );

    if (!match) {
        return null;
    }

    return `${Number(match[1])}/${match[2]}`;
}

// ========================================
// EXTRACT NOTIFICATION DATE
// Format: DD/MM/YYYY or DD-MM-YYYY
// ========================================

function getNotificationDate(text) {
    const match = String(text || "").match(
        /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/
    );

    if (!match) {
        return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return date.toISOString().slice(0, 10);
}

// ========================================
// DATE COMPARISON
// ========================================

function dateValue(date) {
    if (!date) {
        return 0;
    }

    const value = Date.parse(`${date}T00:00:00Z`);

    return Number.isNaN(value) ? 0 : value;
}

// ========================================
// BUILD UNIQUE JOB KEY
// ========================================

function getJobKey(job) {
    const number =
        job.notificationNumber ||
        getNotificationNumber(
            `${job.title || ""} ${job.notificationUrl || ""}`
        );

    if (number) {
        return `APPSC-${number}`;
    }

    return `URL-${job.notificationUrl || job.id}`;
}

// ========================================
// NORMALIZE PDF URL
// ========================================

function normalizePDFURL(url) {
    if (!url) {
        return "";
    }

    try {
        const parsed = new URL(String(url).trim());

        parsed.hash = "";

        return parsed.href;

    } catch {
        return String(url).trim();
    }
}

// ========================================
// CLEAN REVISION HISTORY
// ========================================

function cleanRevisionHistory(history, primaryURL) {
    const primary = normalizePDFURL(primaryURL);

    const unique = new Map();

    const items = Array.isArray(history)
        ? history
        : [];

    for (const revision of items) {
        if (!revision || !revision.url) {
            continue;
        }

        const normalizedURL = normalizePDFURL(revision.url);

        // Remove primary PDF from revision history
        if (
            !normalizedURL ||
            normalizedURL === primary
        ) {
            continue;
        }

        // Remove duplicate URLs
        if (!unique.has(normalizedURL)) {
            unique.set(normalizedURL, {
                url: revision.url,
                title:
                    revision.title ||
                    "APPSC Notification PDF",
                notificationDate:
                    revision.notificationDate || null,
                sourcePage:
                    revision.sourcePage || "APPSC"
            });
        }
    }

    return [...unique.values()];
}

// ========================================
// ADD REVISION WITHOUT DUPLICATES
// ========================================

function addRevision(history, item, primaryURL) {
    const result = cleanRevisionHistory(
        history,
        primaryURL
    );

    if (!item || !item.url) {
        return result;
    }

    const newURL = normalizePDFURL(item.url);

    const primary = normalizePDFURL(primaryURL);

    if (
        !newURL ||
        newURL === primary
    ) {
        return result;
    }

    const alreadyExists = result.some(
        revision =>
            normalizePDFURL(revision.url) === newURL
    );

    if (alreadyExists) {
        return result;
    }

    result.push({
        url: item.url,
        title:
            item.title ||
            "APPSC Notification PDF",
        notificationDate:
            item.notificationDate || null,
        sourcePage:
            item.sourcePage || "APPSC"
    });

    return result;
}

// ========================================
// MERGE OLD AND NEW NOTIFICATIONS
// ========================================

function mergeNotification(existing, incoming) {
    const oldHistory = Array.isArray(existing.revisionHistory)
        ? existing.revisionHistory
        : [];

    const newHistory = Array.isArray(incoming.alternateLinks)
        ? incoming.alternateLinks
        : Array.isArray(incoming.revisionHistory)
            ? incoming.revisionHistory
            : [];

    const oldPrimaryURL =
        existing.notificationUrl ||
        existing.officialLink ||
        "";

    const incomingURL =
        incoming.notificationUrl ||
        incoming.officialLink ||
        "";

    let result = { ...existing };

    let primaryURL = oldPrimaryURL;

    const oldDate = dateValue(existing.notificationDate);

    const newDate = dateValue(incoming.notificationDate);

    // Promote incoming PDF only when its date is newer
    if (
        incomingURL &&
        normalizePDFURL(incomingURL) !==
            normalizePDFURL(oldPrimaryURL) &&
        newDate > oldDate
    ) {
        // Preserve old primary PDF as a revision
        result.revisionHistory = addRevision(
            oldHistory,
            {
                url: oldPrimaryURL,
                title: existing.title,
                notificationDate:
                    existing.notificationDate || null,
                sourcePage:
                    existing.sourcePage || "APPSC"
            },
            incomingURL
        );

        // Update primary notification details
        result = {
            ...result,
            title: incoming.title || existing.title,
            notificationUrl: incomingURL,
            notificationDate: incoming.notificationDate,
            sourcePage:
                incoming.sourcePage || existing.sourcePage,
            year: incoming.year || existing.year
        };

        primaryURL = incomingURL;

    } else {
        // Clean existing history
        result.revisionHistory = cleanRevisionHistory(
            oldHistory,
            primaryURL
        );

        // Preserve incoming PDF only if it is different
        if (
            incomingURL &&
            normalizePDFURL(incomingURL) !==
                normalizePDFURL(primaryURL)
        ) {
            result.revisionHistory = addRevision(
                result.revisionHistory,
                {
                    url: incomingURL,
                    title: incoming.title,
                    notificationDate:
                        incoming.notificationDate,
                    sourcePage: incoming.sourcePage
                },
                primaryURL
            );
        }
    }

    // Add alternate PDFs without duplicates
    for (const revision of newHistory) {
        result.revisionHistory = addRevision(
            result.revisionHistory,
            revision,
            primaryURL
        );
    }

    // Final cleanup
    result.revisionHistory = cleanRevisionHistory(
        result.revisionHistory,
        primaryURL
    );

    return result;
}

// ========================================
// EXTRACT OFFICIAL PDF LINKS
// ========================================

function extractNotifications(html, page) {
    const $ = cheerio.load(html);

    const results = new Map();

    $("a[href]").each((index, element) => {
        const anchor = $(element);

        const title = anchor
            .text()
            .replace(/\s+/g, " ")
            .trim();

        const rowText = anchor
            .closest("tr")
            .text()
            .replace(/\s+/g, " ")
            .trim();

        const contextText = `${title} ${rowText}`;

        const href = anchor.attr("href");

        if (!href) {
            return;
        }

        try {
            const parsedURL = new URL(href, page.url);

            if (parsedURL.protocol !== "https:") {
                return;
            }

            if (!ALLOWED_HOSTS.includes(parsedURL.hostname)) {
                return;
            }

            if (!/\.pdf(?:$|[?#])/i.test(parsedURL.href)) {
                return;
            }

            const notificationNumber = getNotificationNumber(
                `${contextText} ${parsedURL.href}`
            );

            let year;

            if (notificationNumber) {
                year = Number(
                    notificationNumber.split("/")[1]
                );

            } else {
                const yearMatch =
                    contextText.match(/\b(20\d{2})\b/) ||
                    parsedURL.href.match(/\b(20\d{2})\b/);

                if (!yearMatch) {
                    return;
                }

                year = Number(yearMatch[1]);
            }

            if (!YEARS.includes(year)) {
                return;
            }

            const officialLink = parsedURL.href;

            const notificationDate =
                getNotificationDate(contextText);

            const item = {
                title:
                    title ||
                    rowText ||
                    "APPSC Official Notification PDF",

                year,
                notificationNumber,
                notificationDate,
                officialLink,
                sourcePage: page.name
            };

            const key = notificationNumber
                ? `APPSC-${notificationNumber}`
                : `URL-${officialLink}`;

            if (!results.has(key)) {
                results.set(key, item);

            } else {
                const previous = results.get(key);

                if (
                    dateValue(item.notificationDate) >
                    dateValue(previous.notificationDate)
                ) {
                    item.alternateLinks = [
                        ...(previous.alternateLinks || []),
                        {
                            url: previous.officialLink,
                            title: previous.title,
                            notificationDate:
                                previous.notificationDate,
                            sourcePage: previous.sourcePage
                        }
                    ];

                    results.set(key, item);

                } else {
                    previous.alternateLinks =
                        previous.alternateLinks || [];

                    previous.alternateLinks.push({
                        url: item.officialLink,
                        title: item.title,
                        notificationDate:
                            item.notificationDate,
                        sourcePage: item.sourcePage
                    });
                }
            }

        } catch {
            console.log(
                "Skipping invalid URL:",
                href
            );
        }
    });

    return [...results.values()];
}

// ========================================
// CONSOLIDATE EXISTING PENDING RECORDS
// ========================================

function consolidateExistingJobs(jobs) {
    const grouped = new Map();

    const unkeyed = [];

    for (const job of jobs) {
        // Clean even single records
        const cleanedJob = {
            ...job,

            revisionHistory: cleanRevisionHistory(
                job.revisionHistory,
                job.notificationUrl || job.officialLink || ""
            )
        };

        const key = getJobKey(cleanedJob);

        if (
            key.startsWith("URL-") &&
            !cleanedJob.notificationUrl
        ) {
            unkeyed.push(cleanedJob);
            continue;
        }

        if (!grouped.has(key)) {
            grouped.set(key, cleanedJob);
            continue;
        }

        const existing = grouped.get(key);

        const incoming = {
            title: cleanedJob.title,

            notificationUrl: cleanedJob.notificationUrl,

            notificationDate:
                cleanedJob.notificationDate ||
                getNotificationDate(cleanedJob.title || ""),

            sourcePage: cleanedJob.sourcePage,

            year: cleanedJob.year,

            revisionHistory:
                cleanedJob.revisionHistory || []
        };

        const merged = mergeNotification(
            existing,
            incoming
        );

        grouped.set(key, {
            ...cleanedJob,
            ...merged,

            id: existing.id || cleanedJob.id,

            verificationStatus:
                existing.verificationStatus ||
                cleanedJob.verificationStatus,

            interview:
                existing.interview ||
                cleanedJob.interview,

            verified:
                existing.verified === true ||
                cleanedJob.verified === true
        });
    }

    return [
        ...grouped.values(),
        ...unkeyed
    ];
}

// ========================================
// MAIN APPSC SCANNER
// ========================================

async function filterAPPSC() {
    console.log("\n====================================");
    console.log("         DURGA JOB ALERTS");
    console.log("         APPSC AUTO SCANNER");
    console.log("====================================\n");

    console.log("India current year:", CURRENT_YEAR);

    console.log(
        "Monitoring years:",
        YEARS.join(", ")
    );

    let pendingJobs;

    try {
        pendingJobs = loadPendingJobs();

        // Clean existing records before scanning
        pendingJobs = consolidateExistingJobs(pendingJobs);

    } catch (error) {
        console.error(
            "Unable to read pending-jobs.json:",
            error.message
        );

        process.exitCode = 1;
        return;
    }

    const existingByKey = new Map();

    for (const job of pendingJobs) {
        existingByKey.set(
            getJobKey(job),
            job
        );
    }

    const allResults = new Map();

    let successfulPages = 0;
    let failedPages = 0;
    let added = 0;
    let updated = 0;

    // ====================================
    // SCAN OFFICIAL APPSC PAGES
    // ====================================

    for (const page of PAGES) {
        console.log("\n------------------------------------");

        console.log("Scanning:", page.name);

        console.log("URL:", page.url);

        console.log("------------------------------------");

        try {
            const html = await fetchWithRetry(page);

            const notifications =
                extractNotifications(html, page);

            successfulPages++;

            console.log(
                "Unique notifications found:",
                notifications.length
            );

            for (const notification of notifications) {
                const key = notification.notificationNumber
                    ? `APPSC-${notification.notificationNumber}`
                    : `URL-${notification.officialLink}`;

                if (!allResults.has(key)) {
                    allResults.set(key, notification);

                } else {
                    const previous = allResults.get(key);

                    const merged = mergeNotification(
                        {
                            id: "TEMP",
                            title: previous.title,
                            notificationUrl: previous.officialLink,
                            notificationDate:
                                previous.notificationDate,
                            sourcePage: previous.sourcePage,
                            revisionHistory:
                                previous.alternateLinks || []
                        },
                        {
                            title: notification.title,
                            notificationUrl:
                                notification.officialLink,
                            notificationDate:
                                notification.notificationDate,
                            sourcePage: notification.sourcePage,
                            year: notification.year,
                            alternateLinks:
                                notification.alternateLinks || []
                        }
                    );

                    allResults.set(key, {
                        ...previous,

                        title: merged.title,

                        officialLink:
                            merged.notificationUrl,

                        notificationDate:
                            merged.notificationDate,

                        sourcePage:
                            merged.sourcePage,

                        alternateLinks:
                            merged.revisionHistory
                    });
                }
            }

        } catch (error) {
            failedPages++;

            console.error(
                `Failed to scan ${page.name}:`,
                error.message
            );
        }
    }

    // ====================================
    // STOP IF ALL PAGES FAILED
    // ====================================

    if (successfulPages === 0) {
        console.error("\nAll APPSC pages failed.");

        console.error(
            "Existing pending file was not changed."
        );

        process.exitCode = 1;
        return;
    }

    // ====================================
    // MERGE NEW NOTIFICATIONS
    // ====================================

    for (const [key, job] of allResults.entries()) {
        const existing = existingByKey.get(key);

        if (existing) {
            const merged = mergeNotification(
                existing,
                job
            );

            const changed =
                merged.notificationUrl !==
                    existing.notificationUrl ||

                JSON.stringify(
                    merged.revisionHistory || []
                ) !== JSON.stringify(
                    existing.revisionHistory || []
                );

            if (changed) {
                existingByKey.set(key, merged);

                updated++;
            }

            continue;
        }

        // New records remain pending
        const newJob = {
            id: `APPSC-${Date.now()}-${added + 1}`,

            title: job.title,

            notificationNumber:
                job.notificationNumber || null,

            notificationDate:
                job.notificationDate || null,

            department:
                "Andhra Pradesh Public Service Commission",

            category: "AP Government",

            jobType: "Andhra Pradesh Government",

            qualification: "Not verified",

            location: "Andhra Pradesh",

            year: job.year,

            source: "APPSC Official Website",

            sourcePage: job.sourcePage,

            notificationUrl: job.officialLink,

            applyUrl: "",

            discoveredAt: new Date().toISOString(),

            verificationStatus: "Pending Verification",

            interview: "Not Verified",

            verified: false,

            revisionHistory: []
        };

        // Add alternate PDFs safely
        for (const revision of job.alternateLinks || []) {
            newJob.revisionHistory = addRevision(
                newJob.revisionHistory,
                revision,
                newJob.notificationUrl
            );
        }

        existingByKey.set(key, newJob);

        added++;

        console.log("\nNew notification:");

        console.log("Title:", job.title);

        console.log("PDF:", job.officialLink);
    }

    // ====================================
    // FINAL CLEANUP BEFORE SAVING
    // ====================================

    pendingJobs = consolidateExistingJobs(
        [...existingByKey.values()]
    );

    // ====================================
    // SAVE PENDING RECORDS
    // ====================================

    try {
        fs.writeFileSync(
            PENDING_FILE,
            JSON.stringify(pendingJobs, null, 2) + "\n",
            "utf8"
        );

    } catch (error) {
        console.error(
            "Unable to save pending file:",
            error.message
        );

        process.exitCode = 1;
        return;
    }

    // ====================================
    // YEAR-WISE SUMMARY
    // ====================================

    console.log("\n========== YEAR-WISE RESULTS ==========");

    for (const year of YEARS) {
        const yearJobs = [...allResults.values()].filter(
            job => job.year === year
        );

        console.log(`\nYEAR: ${year}`);

        console.log(
            "Unique notifications:",
            yearJobs.length
        );

        for (const job of yearJobs) {
            console.log(
                `${job.notificationNumber || "Unknown"} - ${job.title}`
            );

            console.log("PDF:", job.officialLink);
        }
    }

    // ====================================
    // FINAL SUMMARY
    // ====================================

    console.log("\n========== FINAL SUMMARY ==========");

    console.log("Pages successful:", successfulPages);

    console.log("Pages failed:", failedPages);

    console.log(
        "Monitoring years:",
        YEARS.join(", ")
    );

    console.log(
        "Unique notifications discovered:",
        allResults.size
    );

    console.log(
        "New notifications added:",
        added
    );

    console.log(
        "Existing notifications updated:",
        updated
    );

    console.log(
        "Total unique pending records:",
        pendingJobs.length
    );

    console.log("Saved file: pending-jobs.json");

    console.log("\nIMPORTANT:");

    console.log(
        "All discovered records remain pending verification."
    );

    console.log(
        "Interview status is not automatically verified."
    );

    console.log(
        "Do not publish without checking official PDFs."
    );

    console.log("\nAPPSC scanning completed.");

    if (failedPages > 0) {
        console.error(
            "\nWARNING: Some pages failed. This was a partial scan."
        );

        process.exitCode = 1;
    }
}

// ========================================
// START SCANNER
// ========================================

if (require.main === module) {
    filterAPPSC().catch(error => {
        console.error(
            "\nAPPSC SCANNER FAILED:",
            error
        );

        process.exitCode = 1;
    });
}

// ========================================
// EXPORT
// ========================================

module.exports = {
    filterAPPSC
};
