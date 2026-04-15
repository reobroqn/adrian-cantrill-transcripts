import "dotenv/config";
import { launchBrowser, createPage } from "../src/services/browser/core";
import { ensurePlaying } from "../src/services/browser/player/actions/player";
import { config } from "../src/config";
import { LOGIN_URL } from "../src/services/browser/constants";
import { writeFileSync } from "node:fs";

async function main() {
    console.log("Launching browser to capture fresh master playlist...");
    await using browser = await launchBrowser({ headless: true });
    await using page = await createPage(browser);

    let masterM3u8Url = "";

    page.on("response", (res) => {
        const url = res.url();
        if (url.includes("hotmart.com") && url.includes(".m3u8") && url.includes("master")) {
            masterM3u8Url = url;
            console.log("\n[SUCCESS] Captured Fresh Master HLS Playlist URL!");
        }
    });

    console.log(`Opening login portal: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2000));

    console.log("Filling credentials...");
    await page.evaluate((sel, val) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (el) { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }, "#email", config.email);
    await page.evaluate((sel, val) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (el) { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }, "#password", config.password);

    console.log("Submitting form...");
    await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }),
        page.click('input[type="submit"], button[type="submit"], input.btn-primary.button'),
    ]);

    const testUrl = "https://learn.cantrill.io/courses/aws-certified-solutions-architect-associate-saa-c03/lectures/41301638";
    console.log(`Navigating to lecture: ${testUrl}`);
    await page.goto(testUrl, { waitUntil: "networkidle2" });

    console.log("Ensuring video is playing to trigger HLS stream...");
    await ensurePlaying(page);

    console.log("Waiting for playlist capture...");
    for (let i = 0; i < 15; i++) {
        if (masterM3u8Url) break;
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!masterM3u8Url) {
        console.error("Failed to capture master m3u8 url!");
        return;
    }

    console.log("\n==================================================");
    console.log("Starting Direct Node.js VTT Extraction (Method 4)");
    console.log("==================================================");

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://player.hotmart.com/",
        "Origin": "https://player.hotmart.com"
    };

    const masterRes = await fetch(masterM3u8Url, { headers });
    if (!masterRes.ok) {
        console.error(`Failed to fetch master playlist: ${masterRes.status} ${masterRes.statusText}`);
        return;
    }
    const masterM3u8Content = await masterRes.text();

    const lines = masterM3u8Content.split("\n");
    const enLine = lines.find(l => l.includes("EXT-X-MEDIA:TYPE=SUBTITLES") && l.includes('LANGUAGE="en"'));
    if (!enLine) {
        console.error("Could not find English subtitle track line in master playlist!");
        return;
    }

    const uriMatch = enLine.match(/URI="([^"]+)"/);
    if (!uriMatch || !uriMatch[1]) {
        console.error("Could not extract URI from English subtitle line!");
        return;
    }
    const relativeUri = uriMatch[1];

    const baseUrl = masterM3u8Url.substring(0, masterM3u8Url.lastIndexOf("/") + 1);
    const subtitlePlaylistUrl = baseUrl + relativeUri;
    console.log(`\nFetching English Subtitle Playlist:\n${subtitlePlaylistUrl.slice(0, 120)}...`);

    const subPlaylistRes = await fetch(subtitlePlaylistUrl, { headers });
    if (!subPlaylistRes.ok) {
        console.error(`Failed to fetch subtitle playlist: ${subPlaylistRes.status} ${subPlaylistRes.statusText}`);
        return;
    }
    const subPlaylistContent = await subPlaylistRes.text();

    console.log("\n--- Subtitle Playlist Content ---");
    console.log(subPlaylistContent.slice(0, 2000));
    console.log("---------------------------------");

    // Extract segment URLs (anything that doesn't start with # and isn't empty)
    const subLines = subPlaylistContent.split("\n");
    const vttFiles = subLines.filter(l => l.trim().length > 0 && !l.trim().startsWith("#"));
    console.log(`Found ${vttFiles.length} segment URIs in playlist.`);

    if (vttFiles.length === 0) {
        console.error("No segment files found in subtitle playlist!");
        return;
    }

    console.log("\nDownloading first 5 VTT segments directly via Node fetch()...");
    let fullTranscript = "WEBVTT\n\n";

    for (let i = 0; i < Math.min(5, vttFiles.length); i++) {
        const vttSegmentUri = vttFiles[i].trim();
        const vttUrl = baseUrl + vttSegmentUri;
        console.log(`Fetching segment ${i + 1}: ${vttUrl.slice(0, 90)}...`);
        
        const vttRes = await fetch(vttUrl, { headers });
        if (!vttRes.ok) {
            console.error(`Failed to fetch VTT segment ${i + 1}: ${vttRes.status} ${vttRes.statusText}`);
            continue;
        }
        let vttText = await vttRes.text();
        vttText = vttText.replace(/WEBVTT[\r\n]+/g, "");
        vttText = vttText.replace(/X-TIMESTAMP-MAP=[^\r\n]+[\r\n]+/g, "");
        fullTranscript += vttText.trim() + "\n\n";
    }

    const outputPath = "scratch/extracted-transcript.vtt";
    writeFileSync(outputPath, fullTranscript.trim() + "\n");
    console.log(`\n[SUCCESS] Saved concatenated VTT transcript to ${outputPath}`);
    console.log("\n--- Transcript Preview (First 1500 chars) ---");
    console.log(fullTranscript.slice(0, 1500));
    console.log("---------------------------------------------");
}

main().catch(err => console.error("Error:", err));
