
const cheerio = require("cheerio");

const WEBSITE_URL =
    "https://portal-psc.ap.gov.in/HomePages/RecruitmentNotifications";

async function filterAPPSC() {
    try {
        console.log("===== DURGA JOB ALERTS =====");
        console.log("APPSC Notification Year Filter");
        console.log("Monitoring: 2026, 2027, 2028\n");

        const response = await fetch(WEBSITE_URL, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(20000)
        });

        if (!response.ok) {
            throw new Error("Website error: " + response.status);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const years = [2026, 2027, 2028];
        const results = new Map();

        $("a").each((index, element) => {
            const title = $(element)
                .text()
                .replace(/\s+/g, " ")
                .trim();

            const href = $(element).attr("href");

            if (!title || !href) return;

            const combined = title + " " + href;

            const yearMatch = combined.match(/\b(2026|2027|2028)\b/);

            if (!yearMatch) return;

            const year = Number(yearMatch[1]);

            if (!years.includes(year)) return;

            let officialLink;

            try {
                officialLink = new URL(href, WEBSITE_URL).href;
            } catch {
                return;
            }

            if (!/notification|recruitment/i.test(combined)) return;

            const key = year + "|" + officialLink;

            results.set(key, {
                year,
                title,
                officialLink
            });
        });

        for (const year of years) {
            console.log("\n========== " + year + " ==========");

            const jobs = [...results.values()]
                .filter(item => item.year === year);

            if (jobs.length === 0) {
                console.log("No matching notifications found.");
                continue;
            }

            jobs.forEach((job, index) => {
                console.log("\n" + (index + 1) + ". " + job.title);
                console.log("Official PDF/Page: " + job.officialLink);
            });

            console.log("\nTotal:", jobs.length);
        }

        console.log("\nYear filtering completed.");
        console.log("NOTE: Active dates and no-interview status");
        console.log("are NOT verified by this filter.");

    } catch (error) {
        console.log("ERROR:", error.message);
    }
}

filterAPPSC();
