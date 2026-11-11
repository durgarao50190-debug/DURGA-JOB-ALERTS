
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

// Official APPSC domains allowed
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
const TIMEOUT_MS = 30;

// Wait helper
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch APPSC page using secure Windows curl
function fetchAPPSCWebsite(page) {
    return new Promise((resolve, reject) => {

        const args = [
            "-fL",
            "--silent",
            "--show-error",
            "--max-time", String(TIMEOUT_MS),
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

                } catch (error) {
                    return reject(
                        new Error("Invalid final response URL.")
                    );
                }

                if (!html.trim()) {
                    return reject(
                        new Error("APPSC returned an empty HTML page.")
                    );
                }

                console.log("Secure connection successful.");
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

// Fetch with retry
async function fetchWithRetry(page) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {

        try {
            console.log(
                `Connecting to ${page.name}... Attempt ${attempt}/${MAX_RETRIES}`
            );

            const html = await fetchAPPSCWebsite(page);

            return html;

        } catch (error) {

            lastError = error;

            console.error(
                `Attempt ${attempt} failed:`,
                error.message
            );

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
                title: title || "APPSC Official Notification PDF",
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

        console.error(
            "Unable to read pending-jobs.json:",
            error.message
        );

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

            const html = await fetchWithRetry(page);

            console.log("Website connected successfully.");

            const notifications = extractNotifications(html, page);

            successfulPages++;

            console.log(
                "Official PDF links found:",
                notifications.length
            );

            for (const notification of notifications) {

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

    // Do not overwrite if both pages failed
    if (successfulPages === 0) {

        console.error("\nBoth APPSC pages failed.");
        console.error(
            "Existing pending-jobs.json was not changed."
        );

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
        console.log("Official PDF:", job.officialLink);
    }

    // Save pending jobs
    try {

        fs.writeFileSync(
            PENDING_FILE,
            JSON.stringify(pendingJobs, null, 2) + "\n",
            "utf8"
        );

    } catch (error) {

        console.error(
            "Unable to save pending-jobs.json:",
            error.message
        );

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

    // A partial scan should not be reported as fully successful
    if (failedPages > 0) {
        console.error(
            "\nWARNING: Some APPSC pages could not be scanned."
        );
        process.exitCode = 1;
    }
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
