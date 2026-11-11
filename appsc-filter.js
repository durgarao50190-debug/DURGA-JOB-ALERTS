
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

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

// Official APPSC domains allowed for PDF links
const ALLOWED_HOSTS = [
    "portal-psc.ap.gov.in",
    "psc.ap.gov.in"
];

// Data file
const PENDING_FILE = path.join(__dirname, "pending-jobs.json");

// Monitoring years
const YEARS = [2026, 2027, 2028];

// Connection settings
const MAX_RETRIES = 3;
const TIMEOUT_MS = 25000;

// Wait helper
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch one APPSC page with retry
async function fetchAPPSCWebsite(page) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(
                `Connecting to ${page.name}... Attempt ${attempt}/${MAX_RETRIES}`
            );

            const response = await fetch(page.url, {
                method: "GET",
                redirect: "follow",
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-IN,en;q=0.9",
                    "Cache-Control": "no-cache"
                },
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // Validate final redirect destination
            const finalURL = new URL(response.url);

            if (
                finalURL.protocol !== "https:" ||
                !ALLOWED_HOSTS.includes(finalURL.hostname)
            ) {
                throw new Error(
                    `Unexpected redirect destination: ${response.url}`
                );
            }

            const html = await response.text();

            if (!html || html.trim().length === 0) {
                throw new Error("APPSC returned an empty page.");
            }

            return html;

        } catch (error) {
            lastError = error;

            console.error(
                `Connection attempt ${attempt} failed:`,
                error.message
            );

            if (error.cause) {
                console.error("Cause:", error.cause.message || error.cause);
                console.error("Error code:", error.cause.code || "Unknown");
            }

            if (attempt < MAX_RETRIES) {
                console.log("Retrying in 5 seconds...\n");
                await wait(5000);
            }
        }
    }

    throw new Error(
        `Unable to connect to ${page.name} after ${MAX_RETRIES} attempts. ` +
        `Last error: ${lastError?.message || "Unknown error"}`
    );
}

// Read existing pending jobs
function loadPendingJobs() {
    if (!fs.existsSync(PENDING_FILE)) {
        return [];
    }

    const fileData = fs.readFileSync(PENDING_FILE, "utf8");

    if (!fileData.trim()) {
        return [];
    }

    const pendingJobs = JSON.parse(fileData);

    if (!Array.isArray(pendingJobs)) {
        throw new Error(
            "pending-jobs.json must contain a JSON array."
        );
    }

    return pendingJobs;
}

// Extract official notification PDF links
function extractNotifications(html, page) {
    const $ = cheerio.load(html);
    const results = new Map();

    $("a[href]").each((index, element) => {
        const title = $(element)
            .text()
            .replace(/\s+/g, " ")
            .trim();

        const href = $(element).attr("href");

        if (!href) return;

        try {
            const parsedURL = new URL(href, page.url);

            // Only HTTPS links
            if (parsedURL.protocol !== "https:") return;

            // Only official APPSC domains
            if (!ALLOWED_HOSTS.includes(parsedURL.hostname)) return;

            // Only PDF documents
            if (!/\.pdf(?:$|[?#])/i.test(parsedURL.href)) return;

            const combinedText = `${title} ${parsedURL.href}`;

            // Find monitoring year
            const yearMatch = combinedText.match(
                /\b(2026|2027|2028)\b/
            );

            if (!yearMatch) return;

            const year = Number(yearMatch[1]);

            if (!YEARS.includes(year)) return;

            const officialLink = parsedURL.href;

            results.set(officialLink, {
                title:
                    title || "APPSC Official Notification PDF",
                year,
                officialLink,
                sourcePage: page.name
            });

        } catch (error) {
            console.log("Skipping invalid URL:", href);
        }
    });

    return [...results.values()];
}

// Main scanner
async function filterAPPSC() {
    console.log("\n====================================");
    console.log("         DURGA JOB ALERTS");
    console.log("         APPSC AUTO SCANNER");
    console.log("====================================\n");

    let pendingJobs = [];

    try {
        pendingJobs = loadPendingJobs();
    } catch (error) {
        console.error("Unable to read pending-jobs.json:", error.message);
        process.exitCode = 1;
        return;
    }

    const existingLinks = new Set(
        pendingJobs
            .map(job => job.notificationUrl)
            .filter(Boolean)
    );

    let added = 0;
    let successfulPages = 0;
    let failedPages = 0;

    const allResults = new Map();

    // Scan both APPSC pages
    for (const page of PAGES) {
        console.log("\n------------------------------------");
        console.log("Scanning:", page.name);
        console.log("URL:", page.url);
        console.log("------------------------------------\n");

        try {
            const html = await fetchAPPSCWebsite(page);

            console.log("Website connected successfully.");

            const notifications = extractNotifications(html, page);

            successfulPages++;

            console.log(
                "Official PDF links found:",
                notifications.length
            );

            for (const notification of notifications) {
                // Keep one record per PDF URL
                if (!allResults.has(notification.officialLink)) {
                    allResults.set(
                        notification.officialLink,
                        notification
                    );
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

    // Do not overwrite the file if both pages failed
    if (successfulPages === 0) {
        console.error("\nBoth APPSC pages failed.");
        console.error("Existing pending-jobs.json was not changed.");
        process.exitCode = 1;
        return;
    }

    // Save newly discovered notifications
    for (const job of allResults.values()) {
        if (existingLinks.has(job.officialLink)) {
            continue;
        }

        const newJob = {
            id: `APPSC-${Date.now()}-${added + 1}`,

            title: job.title,

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

            verified: false
        };

        pendingJobs.push(newJob);

        existingLinks.add(job.officialLink);

        added++;

        console.log("\nNew notification discovered:");
        console.log("Title:", job.title);
        console.log("PDF:", job.officialLink);
    }

    // Save pending jobs
    try {
        fs.writeFileSync(
            PENDING_FILE,
            JSON.stringify(pendingJobs, null, 2) + "\n",
            "utf8"
        );
    } catch (error) {
        console.error("Unable to save pending-jobs.json:", error.message);
        process.exitCode = 1;
        return;
    }

    // Year-wise results
    console.log("\n========== SCAN RESULTS ==========\n");

    for (const year of YEARS) {
        const yearJobs = [...allResults.values()].filter(
            job => job.year === year
        );

        console.log("YEAR:", year);
        console.log("PDF notifications found:", yearJobs.length);

        yearJobs.forEach((job, index) => {
            console.log(`${index + 1}. ${job.title}`);
            console.log("Official PDF:", job.officialLink);
        });

        console.log("");
    }

    // Final summary
    console.log("========== SUMMARY ==========");
    console.log("Pages scanned successfully:", successfulPages);
    console.log("Pages failed:", failedPages);
    console.log("PDF notifications discovered:", allResults.size);
    console.log("New notifications added:", added);
    console.log("Total pending notifications:", pendingJobs.length);
    console.log("Saved file: pending-jobs.json");

    console.log("\nIMPORTANT:");
    console.log("Notifications are NOT verified jobs.");
    console.log("Interview status is NOT verified.");
    console.log("Check the official PDF before publishing.");
    console.log("Only verified eligible jobs should be published.");

    console.log("\nAPPSC scanning completed.");
}

// Run directly or import into another file
if (require.main === module) {
    filterAPPSC().catch(error => {
        console.error("\nAPPSC SCANNER FAILED:", error);
        process.exitCode = 1;
    });
}

module.exports = {
    filterAPPSC
};
