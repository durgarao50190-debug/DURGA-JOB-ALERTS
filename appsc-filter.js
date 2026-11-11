
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// APPSC official recruitment page
const WEBSITE_URL =
    "https://portal-psc.ap.gov.in/HomePages/RecruitmentNotifications";

// Data file
const PENDING_FILE = path.join(__dirname, "pending-jobs.json");

// Monitoring years
const YEARS = [2026, 2027, 2028];

// Connection settings
const MAX_RETRIES = 3;
const TIMEOUT_MS = 20000;

// Wait helper
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Connect to APPSC with retry
async function fetchAPPSCWebsite() {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(
                `Connecting to APPSC... Attempt ${attempt}/${MAX_RETRIES}`
            );

            const response = await fetch(WEBSITE_URL, {
                method: "GET",
                redirect: "follow",
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Cache-Control": "no-cache"
                },
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });

            if (!response.ok) {
                throw new Error(
                    `APPSC website returned HTTP ${response.status}`
                );
            }

            const html = await response.text();

            if (!html || html.trim().length === 0) {
                throw new Error("APPSC website returned an empty page.");
            }

            return html;

        } catch (error) {
            lastError = error;

            console.error(
                `Connection attempt ${attempt} failed:`,
                error.message
            );

            if (error.cause) {
                console.error("Cause:", error.cause);
                console.error("Error code:", error.cause.code);
            }

            if (attempt < MAX_RETRIES) {
                console.log("Retrying in 5 seconds...\n");
                await wait(5000);
            }
        }
    }

    throw new Error(
        `Unable to connect to APPSC after ${MAX_RETRIES} attempts. ` +
        `Last error: ${lastError?.message || "Unknown error"}`
    );
}

// Main scanner
async function filterAPPSC() {
    console.log("\n================================");
    console.log("       DURGA JOB ALERTS");
    console.log("       APPSC AUTO SCANNER");
    console.log("================================\n");

    try {
        // Read existing pending jobs
        let pendingJobs = [];

        if (fs.existsSync(PENDING_FILE)) {
            const fileData = fs.readFileSync(
                PENDING_FILE,
                "utf8"
            );

            pendingJobs = JSON.parse(fileData);

            if (!Array.isArray(pendingJobs)) {
                throw new Error(
                    "pending-jobs.json must contain a JSON array."
                );
            }
        }

        // Connect to APPSC
        console.log("APPSC official website connection starting...\n");

        const html = await fetchAPPSCWebsite();

        const $ = cheerio.load(html);

        console.log("\nAPPSC website connected successfully.\n");

        // Existing links for duplicate checking
        const existingLinks = new Set(
            pendingJobs.map(job => job.notificationUrl)
        );

        // Find notifications
        const results = new Map();

        $("a").each((index, element) => {
            const title = $(element)
                .text()
                .replace(/\s+/g, " ")
                .trim();

            const href = $(element).attr("href");

            if (!title || !href) return;

            const combined = `${title} ${href}`;

            // Check monitoring year
            const yearMatch = combined.match(
                /\b(2026|2027|2028)\b/
            );

            if (!yearMatch) return;

            const year = Number(yearMatch[1]);

            if (!YEARS.includes(year)) return;

            // Check notification keywords
            if (!/notification|recruitment/i.test(combined)) {
                return;
            }

            // Convert relative URL to absolute URL
            let officialLink;

            try {
                const parsedUrl = new URL(href, WEBSITE_URL);

                if (parsedUrl.protocol !== "https:") {
                    return;
                }

                officialLink = parsedUrl.href;

            } catch {
                return;
            }

            // Avoid duplicate results in current scan
            results.set(officialLink, {
                year,
                title,
                officialLink
            });
        });

        // Save newly discovered notifications
        let added = 0;

        for (const job of results.values()) {
            if (existingLinks.has(job.officialLink)) {
                continue;
            }

            pendingJobs.push({
                id: `${Date.now()}-${added}`,

                title: job.title,

                department:
                    "Andhra Pradesh Public Service Commission",

                category: "AP Government",

                jobType: "Andhra Pradesh Government",

                qualification: "Not verified",

                location: "Andhra Pradesh",

                year: job.year,

                source: "APPSC Official Website",

                notificationUrl: job.officialLink,

                applyUrl: "",

                discoveredAt: new Date().toISOString(),

                verificationStatus: "Pending Verification",

                interview: "Not Verified",

                verified: false
            });

            existingLinks.add(job.officialLink);
            added++;
        }

        // Save pending jobs
        fs.writeFileSync(
            PENDING_FILE,
            JSON.stringify(pendingJobs, null, 2),
            "utf8"
        );

        // Display year-wise results
        console.log("\n========== SCAN RESULTS ==========\n");

        for (const year of YEARS) {
            const yearJobs = [...results.values()].filter(
                job => job.year === year
            );

            console.log("YEAR:", year);
            console.log(
                "Notifications found:",
                yearJobs.length
            );

            yearJobs.forEach((job, index) => {
                console.log(`${index + 1}. ${job.title}`);
                console.log("Official link:", job.officialLink);
            });

            console.log("");
        }

        // Final summary
        console.log("========== SUMMARY ==========");
        console.log("New notifications added:", added);
        console.log(
            "Total pending notifications:",
            pendingJobs.length
        );
        console.log("Saved file: pending-jobs.json");

        console.log("\nIMPORTANT:");
        console.log(
            "Notifications are NOT verified jobs."
        );
        console.log(
            "Check the official notification PDF before publishing."
        );

        console.log("\nAPPSC scanning completed successfully.");

    } catch (error) {
        console.error("\n========== APPSC SCANNER FAILED ==========");
        console.error("Message:", error.message);
        console.error("Cause:", error.cause || "Not available");
        console.error(
            "Error code:",
            error.cause?.code || error.code || "Not available"
        );

        process.exitCode = 1;
    }
}

// Run directly or import into another file
if (require.main === module) {
    filterAPPSC();
}

module.exports = {
    filterAPPSC
};
