
const cheerio = require("cheerio");

const WEBSITE_URL =
    "https://portal-psc.ap.gov.in/HomePages/RecruitmentNotifications";

async function checkAPPSC() {
    try {
        console.log("==================================");
        console.log("       DURGA JOB ALERTS");
        console.log("       APPSC LIVE READER");
        console.log("==================================");

        console.log("\nConnecting to APPSC...");

        const response = await fetch(WEBSITE_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0"
            },
            signal: AbortSignal.timeout(20000)
        });

        console.log("Website Status:", response.status);

        if (!response.ok) {
            throw new Error("APPSC website returned an error");
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        console.log(
            "Website Title:",
            $("title").text().trim()
        );

        console.log("\nRECRUITMENT NOTIFICATIONS:\n");

        let count = 0;

        $("a").each((index, element) => {
            const title = $(element)
                .text()
                .replace(/\s+/g, " ")
                .trim();

            const href = $(element).attr("href");

            if (!href || !title) return;

            const combinedText = title + " " + href;

            if (
                /notification|recruitment|group|direct recruitment|selection|post|vacancy|apply/i.test(
                    combinedText
                )
            ) {
                let fullURL;

                try {
                    fullURL = new URL(href, WEBSITE_URL).href;
                } catch {
                    return;
                }

                console.log("Notification:", title);
                console.log("Official Link:", fullURL);
                console.log("----------------------------------");

                count++;
            }
        });

        console.log("\nTotal matching links:", count);

        if (count === 0) {
            console.log(
                "No matching links found in page HTML."
            );
            console.log(
                "The page may require JavaScript or a different extraction method."
            );
        }

        console.log("\nAPPSC reading test completed.");

    } catch (error) {
        console.log("\nERROR:", error.message);
    }
}

checkAPPSC();
