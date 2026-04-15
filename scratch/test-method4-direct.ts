import { readFileSync, writeFileSync } from "node:fs";

async function main() {
    console.log("==================================================");
    console.log("Starting Direct Node.js VTT Extraction (Method 4)");
    console.log("==================================================");

    // 1. Read master playlist info from our previous proof capture
    const proofData = JSON.parse(readFileSync("scratch/method4-proof.json", "utf-8"));
    const masterLog = proofData.networkLogs.find((entry: any) => entry.url.includes("master-pkg") && entry.snippet.includes('LANGUAGE="en"'));

    if (!masterLog) {
        console.error("Could not find master playlist log in method4-proof.json!");
        return;
    }

    const masterM3u8Url = masterLog.url;
    const masterM3u8Content = masterLog.snippet;

    console.log(`[SUCCESS] Loaded Master Playlist URL:\n${masterM3u8Url.slice(0, 100)}...`);

    // Check Akamai token expiration
    const expMatch = masterM3u8Url.match(/exp=(\d+)/);
    if (expMatch && expMatch[1]) {
        const expTime = parseInt(expMatch[1], 10) * 1000;
        console.log(`Token Expiration: ${new Date(expTime).toISOString()}`);
        console.log(`Current Time:     ${new Date().toISOString()}`);
        if (Date.now() > expTime) {
            console.warn("\n[WARNING] The Akamai CDN token in method4-proof.json has expired!");
            console.warn("To fetch live VTTs, a fresh master playlist URL with an active token is required.");
        }
    }

    // 2. Extract the English URI
    const lines = masterM3u8Content.split("\n");
    const enLine = lines.find((l: string) => l.includes("EXT-X-MEDIA:TYPE=SUBTITLES") && l.includes('LANGUAGE="en"'));
    if (!enLine) {
        console.error("Could not find English subtitle track line!");
        return;
    }

    const uriMatch = enLine.match(/URI="([^"]+)"/);
    if (!uriMatch || !uriMatch[1]) {
        console.error("Could not extract URI from English subtitle line!");
        return;
    }
    const relativeUri = uriMatch[1];

    // 3. Construct full subtitle playlist URL
    const baseUrl = masterM3u8Url.substring(0, masterM3u8Url.lastIndexOf("/") + 1);
    const subtitlePlaylistUrl = baseUrl + relativeUri;
    console.log(`\nFetching English Subtitle Playlist:\n${subtitlePlaylistUrl.slice(0, 100)}...`);

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://player.hotmart.com/",
        "Origin": "https://player.hotmart.com"
    };

    const subPlaylistRes = await fetch(subtitlePlaylistUrl, { headers });
    if (!subPlaylistRes.ok) {
        console.error(`Failed to fetch subtitle playlist: ${subPlaylistRes.status} ${subPlaylistRes.statusText}`);
        return;
    }
    const subPlaylistContent = await subPlaylistRes.text();

    // 4. Extract VTT segment URLs
    const subLines = subPlaylistContent.split("\n");
    const vttFiles = subLines.filter((l: string) => l.trim().endsWith(".vtt") || l.includes(".vtt?"));
    console.log(`Found ${vttFiles.length} VTT segments in playlist.`);

    if (vttFiles.length === 0) {
        console.error("No VTT files found in subtitle playlist!");
        return;
    }

    // 5. Download and concatenate the first 10 VTT segments as proof
    console.log("\nDownloading first 10 VTT segments directly via Node fetch()...");
    let fullTranscript = "WEBVTT\n\n";

    for (let i = 0; i < Math.min(10, vttFiles.length); i++) {
        const vttSegmentUri = vttFiles[i].trim();
        const vttUrl = baseUrl + vttSegmentUri;
        console.log(`Fetching segment ${i + 1}/${Math.min(10, vttFiles.length)}...`);
        
        const vttRes = await fetch(vttUrl, { headers });
        if (!vttRes.ok) {
            console.error(`Failed to fetch VTT segment ${i + 1}`);
            continue;
        }
        let vttText = await vttRes.text();
        // Remove WEBVTT header from segments if present so it concatenates cleanly
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
