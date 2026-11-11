
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

// Scanner
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
                    "pending-jobs.json must contain an array"
                );
            }
        }

        // Download APPSC page
        console.log("Connecting to APPSC official website...");

        const response = await fetch(WEBSITE_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0 DURGA-JOB-ALERTS"
            },
            signal: AbortSignal.timeout(20000)
        });

        if (!response.ok) {
            throw new Error(
                "APPSC website error: HTTP " + response.status
            );
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        console.log("APPSC website connected successfully.\n");

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

            const combined = title + " " + href;

            // Check year
            const yearMatch = combined.match(
                /\b(2026|2027|2028)\b/
            );

            if (!yearMatch) return;

            const year = Number(yearMatch[1]);

            if (!YEARS.includes(year)) return;

            // Check notification keyword
            if (!/notification|recruitment/i.test(combined)) {
                return;
            }

            // Convert relative URL into absolute URL
            let officialLink;

            try {
                officialLink = new URL(
                    href,
                    WEBSITE_URL
                ).href;
            } catch {
                return;
            }

            // Allow only HTTPS links
            if (!officialLink.startsWith("https://")) {
                return;
            }

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
                id: Date.now() + added,

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
        console.log("========== SCAN RESULTS ==========\n");

        for (const year of YEARS) {

            const yearJobs = [...results.values()].filter(
                job => job.year === year
            );

            console.log("YEAR:", year);
            console.log("Notifications found:", yearJobs.length);

            yearJobs.forEach((job, index) => {
                console.log(
                    `${index + 1}. ${job.title}`
                );

                console.log(
                    "Official link:",
                    job.officialLink
                );
            });

            console.log("");
        }

        console.log("========== SUMMARY ==========");
        console.log("New notifications added:", added);
        console.log("Total pending notifications:", pendingJobs.length);
        console.log("Saved file: pending-jobs.json");

        console.log("\nIMPORTANT:");
        console.log("These notifications are NOT verified jobs.");
        console.log("Check official notification PDF before publishing.");
        console.log("\nAPPSC scanning completed.");

    } catch (error) {

        console.error("\nAPPSC SCANNER FAILED:");
        console.error(error.message);

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
