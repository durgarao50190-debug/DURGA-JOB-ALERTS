
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// APPSC official pages
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

// Automatically monitor current Indian year + next 2 years
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

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Secure HTTPS request using Windows curl
function fetchAPPSCWebsite(page) {
    return new Promise((resolve, reject) => {
        const args = [
            "-fL",
            "--silent",
            "--show-error",
            "--max-time", String(TIMEOUT_SECONDS),
            "-A", "Mozilla/5.0",
            "-H", "Accept: text/html,application/xhtml+xml",
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
                    if (stderr) console.error("Details:", stderr);
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

// Read existing pending records
function loadPendingJobs() {
    if (!fs.existsSync(PENDING_FILE)) {
        return [];
    }

    const data = fs.readFileSync(PENDING_FILE, "utf8");

    if (!data.trim()) return [];

    const jobs = JSON.parse(data);

    if (!Array.isArray(jobs)) {
        throw new Error(
            "pending-jobs.json must contain a JSON array."
        );
    }

    return jobs;
}

// Extract notification number, e.g. 37/2026
function getNotificationNumber(text) {
    const match = text.match(
        /notification\s*(?:no\.?|number)\s*[:.-]?\s*(\d{1,3})\s*\/\s*(20\d{2})/i
    );

    if (!match) return null;

    return `${Number(match[1])}/${match[2]}`;
}

// Extract date in DD/MM/YYYY format
function getNotificationDate(text) {
    const match = text.match(
        /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/
    );

    if (!match) return null;

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

// Convert notification date to comparable number
function dateValue(date) {
    if (!date) return 0;

    const value = Date.parse(`${date}T00:00:00Z`);
    return Number.isNaN(value) ? 0 : value;
}

// Build unique key for a notification
function getJobKey(job) {
    const number = getNotificationNumber(
        `${job.title || ""} ${job.notificationUrl || ""}`
    );

    if (number) {
        return `APPSC-${number}`;
    }

    return `URL-${job.notificationUrl || job.id}`;
}

// Add PDF link to revision history without duplicates
function addRevision(history, item, primaryURL) {
    const existing = Array.isArray(history) ? history : [];

    if (!item.url || item.url === primaryURL) {
        return existing;
    }

    const alreadyExists = existing.some(
        revision => revision.url === item.url
    );

    if (alreadyExists) return existing;

    existing.push({
        url: item.url,
        title: item.title || "APPSC Notification PDF",
        notificationDate: item.notificationDate || null,
        sourcePage: item.sourcePage || "APPSC"
    });

    return existing;
}

// Extract official PDF links from APPSC HTML
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

        if (!href) return;

        try {
            const parsedURL = new URL(href, page.url);

            if (parsedURL.protocol !== "https:") return;

            if (!ALLOWED_HOSTS.includes(parsedURL.hostname)) return;

            if (!/\.pdf(?:$|[?#])/i.test(parsedURL.href)) return;

            // Prefer notification number's year
            const notificationNumber =
                getNotificationNumber(contextText + " " + parsedURL.href);

            let year;

            if (notificationNumber) {
                year = Number(notificationNumber.split("/")[1]);
            } else {
                const yearMatch = contextText.match(
                    /\b(20\d{2})\b/
                ) || parsedURL.href.match(/\b(20\d{2})\b/);

                if (!yearMatch) return;

                year = Number(yearMatch[1]);
            }

            if (!YEARS.includes(year)) return;

            const officialLink = parsedURL.href;
            const notificationDate = getNotificationDate(contextText);

            const item = {
                title: title || "APPSC Official Notification PDF",
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

                // Prefer the notification with the newer date
                if (
                    dateValue(item.notificationDate) >
                    dateValue(previous.notificationDate)
                ) {
                    item.alternateLinks = [
                        ...(previous.alternateLinks || []),
                        {
                            url: previous.officialLink,
                            title: previous.title,
                            notificationDate: previous.notificationDate,
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
                        notificationDate: item.notificationDate,
                        sourcePage: item.sourcePage
                    });
                }
            }
        } catch {
            console.log("Skipping invalid URL:", href);
        }
    });

    return [...results.values()];
}

// Merge old and new versions of the same notification
function mergeNotification(existing, incoming) {
    const oldHistory = Array.isArray(existing.revisionHistory)
        ? existing.revisionHistory
        : [];

    const newHistory = Array.isArray(incoming.alternateLinks)
        ? incoming.alternateLinks
        : [];

    let result = { ...existing };

    const oldDate = dateValue(existing.notificationDate);
    const newDate = dateValue(incoming.notificationDate);

    // Update primary PDF only when the incoming notification date is newer
    if (
        incoming.officialLink &&
        incoming.officialLink !== existing.notificationUrl &&
        newDate > oldDate
    ) {
        const previousPrimary = {
            url: existing.notificationUrl,
            title: existing.title,
            notificationDate: existing.notificationDate || null,
            sourcePage: existing.sourcePage || "APPSC"
        };

        result = {
            ...result,
            title: incoming.title,
            notificationUrl: incoming.officialLink,
            notificationDate: incoming.notificationDate,
            sourcePage: incoming.sourcePage,
            year: incoming.year
        };

        result.revisionHistory = addRevision(
            oldHistory,
            previousPrimary,
            result.notificationUrl
        );
    } else {
        result.revisionHistory = oldHistory;
    }

    // Preserve all other discovered PDF links as history
    for (const revision of newHistory) {
        result.revisionHistory = addRevision(
            result.revisionHistory,
            revision,
            result.notificationUrl
        );
    }

    // Keep the existing ID and verification fields unchanged
    return result;
}

// Consolidate existing duplicate records safely
function consolidateExistingJobs(jobs) {
    const grouped = new Map();
    const unkeyed = [];

    for (const job of jobs) {
        const key = getJobKey(job);

        if (key.startsWith("URL-") && !job.notificationUrl) {
            unkeyed.push(job);
            continue;
        }

        if (!grouped.has(key)) {
            grouped.set(key, job);
            continue;
        }

        const existing = grouped.get(key);

        const incoming = {
            title: job.title,
            notificationUrl: job.notificationUrl,
            notificationDate: job.notificationDate ||
                getNotificationDate(job.title || ""),
            sourcePage: job.sourcePage,
            year: job.year,
            alternateLinks: job.revisionHistory || []
        };

        const merged = mergeNotification(existing, incoming);

        // Keep existing record's ID and verification fields
        grouped.set(key, {
            ...job,
            ...merged,
            id: existing.id || job.id,
            verificationStatus:
                existing.verificationStatus || job.verificationStatus,
            interview: existing.interview || job.interview,
            verified:
                existing.verified === true || job.verified === true
        });
    }

    return [...grouped.values(), ...unkeyed];
}

// Main scanner
async function filterAPPSC() {
    console.log("\n====================================");
    console.log("         DURGA JOB ALERTS");
    console.log("         APPSC AUTO SCANNER");
    console.log("====================================\n");

    console.log("India current year:", CURRENT_YEAR);
    console.log("Monitoring years:", YEARS.join(", "));

    let pendingJobs;

    try {
        pendingJobs = loadPendingJobs();
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
        existingByKey.set(getJobKey(job), job);
    }

    const allResults = new Map();

    let successfulPages = 0;
    let failedPages = 0;
    let added = 0;
    let updated = 0;

    // Scan official APPSC pages
    for (const page of PAGES) {
        console.log("\n------------------------------------");
        console.log("Scanning:", page.name);
        console.log("URL:", page.url);
        console.log("------------------------------------");

        try {
            const html = await fetchWithRetry(page);
            const notifications = extractNotifications(html, page);

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
                            notificationDate: previous.notificationDate,
                            sourcePage: previous.sourcePage,
                            revisionHistory: previous.alternateLinks || []
                        },
                        {
                            title: notification.title,
                            notificationUrl: notification.officialLink,
                            notificationDate: notification.notificationDate,
                            sourcePage: notification.sourcePage,
                            year: notification.year,
                            alternateLinks: notification.alternateLinks || []
                        }
                    );

                    allResults.set(key, {
                        ...previous,
                        title: merged.title,
                        officialLink: merged.notificationUrl,
                        notificationDate: merged.notificationDate,
                        sourcePage: merged.sourcePage,
                        alternateLinks: merged.revisionHistory
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

    if (successfulPages === 0) {
        console.error("\nAll APPSC pages failed.");
        console.error("Existing pending file was not changed.");

        process.exitCode = 1;
        return;
    }

    // Merge newly discovered notifications
    for (const [key, job] of allResults.entries()) {
        const existing = existingByKey.get(key);

        if (existing) {
            const merged = mergeNotification(existing, job);

            if (
                merged.notificationUrl !== existing.notificationUrl ||
                JSON.stringify(merged.revisionHistory || []) !==
                JSON.stringify(existing.revisionHistory || [])
            ) {
                existingByKey.set(key, merged);
                updated++;
            }

            continue;
        }

        const newJob = {
            id: `APPSC-${Date.now()}-${added + 1}`,
            title: job.title,
            notificationNumber: job.notificationNumber || null,
            notificationDate: job.notificationDate || null,
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

    pendingJobs = [...existingByKey.values()];

    // Save pending records
    try {
        fs.writeFileSync(
            PENDING_FILE,
            JSON.stringify(pendingJobs, null, 2) + "\n",
            "utf8"
        );
    } catch (error) {
        console.error("Unable to save pending file:", error.message);
        process.exitCode = 1;
        return;
    }

    // Year-wise summary
    console.log("\n========== YEAR-WISE RESULTS ==========");

    for (const year of YEARS) {
        const yearJobs = [...allResults.values()].filter(
            job => job.year === year
        );

        console.log(`\nYEAR: ${year}`);
        console.log("Unique notifications:", yearJobs.length);

        for (const job of yearJobs) {
            console.log(
                `${job.notificationNumber || "Unknown"} - ${job.title}`
            );
            console.log("PDF:", job.officialLink);
        }
    }

    console.log("\n========== FINAL SUMMARY ==========");
    console.log("Pages successful:", successfulPages);
    console.log("Pages failed:", failedPages);
    console.log("Monitoring years:", YEARS.join(", "));
    console.log("Unique notifications discovered:", allResults.size);
    console.log("New notifications added:", added);
    console.log("Existing notifications updated:", updated);
    console.log("Total unique pending records:", pendingJobs.length);
    console.log("Saved file: pending-jobs.json");

    console.log("\nIMPORTANT:");
    console.log("All discovered records remain pending verification.");
    console.log("Interview status is not automatically verified.");
    console.log("Do not publish without checking official PDFs.");

    console.log("\nAPPSC scanning completed.");

    if (failedPages > 0) {
        console.error(
            "\nWARNING: Some pages failed. This was a partial scan."
        );

        process.exitCode = 1;
    }
}

if (require.main === module) {
    filterAPPSC().catch(error => {
        console.error("\nAPPSC SCANNER FAILED:", error);
        process.exitCode = 1;
    });
}

module.exports = {
    filterAPPSC
};
