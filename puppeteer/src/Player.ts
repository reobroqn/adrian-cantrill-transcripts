import { BaseAutomator, AutomatorOptions } from './BaseAutomator';
import { HTTPRequest } from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

interface Lecture {
    id: string;
    title: string;
    url: string;
}

interface Section {
    section_title: string;
    lectures: Lecture[];
}

interface Manifest {
    sections: Section[];
}

interface PlayerOptions extends AutomatorOptions {
    targetSession?: string; // Optional: Exact name of section to play
    batchSize?: number;     // Optional: Number of videos to play
    startIndex?: number;    // Optional: Offset
}

export class Player extends BaseAutomator {
    private manifestPath: string;
    private targetSession?: string;
    private batchSize: number;
    private startIndex: number;

    constructor(options: PlayerOptions) {
        super(options);
        this.manifestPath = path.join(this.dataDir, 'course_manifest.json');
        this.targetSession = options.targetSession;
        this.batchSize = options.batchSize || 1;
        this.startIndex = options.startIndex || 0;
    }

    async run(): Promise<boolean> {
        if (!await this.init()) return false;
        if (!await this.login()) {
            await this.cleanup();
            return false;
        }

        const success = await this.playManifest();
        await this.cleanup();
        return success;
    }

    async playManifest(): Promise<boolean> {
        let manifest: Manifest;
        try {
            const data = await fs.readFile(this.manifestPath, 'utf8');
            manifest = JSON.parse(data);
        } catch (e) {
            console.error('Could not load course_manifest.json. Run "npm run scrape" first.');
            return false;
        }

        let queue: { section: string, lecture: Lecture }[] = [];

        if (this.targetSession) {
            // Filter by session
            console.log(`Targeting Session: "${this.targetSession}"`);
            const section = manifest.sections.find(s => s.section_title.toLowerCase().includes(this.targetSession!.toLowerCase()));
            if (!section) {
                console.error(`Session "${this.targetSession}" not found.`);
                return false;
            }
            // Add all lectures in this session
            section.lectures.forEach(l => queue.push({ section: section.section_title, lecture: l }));
            console.log(`Found ${queue.length} lectures in session.`);
        } else {
            // Flatten all
            manifest.sections.forEach(s => {
                s.lectures.forEach(l => queue.push({ section: s.section_title, lecture: l }));
            });
            // Apply batch/limit
            queue = queue.slice(this.startIndex, this.startIndex + this.batchSize);
            console.log(`Processing batch of ${queue.length} lectures (Start: ${this.startIndex}).`);
        }

        for (const item of queue) {
            console.log(`\nProcessing: [${item.section}] ${item.lecture.title}`);
            // watchLecture now waits for the video to finish
            const result = await this.watchLecture(item.lecture.url);

            if (result && result.videoId) {
                console.log(`Video finished. Extracted ID: ${result.videoId}`);
                await this.generateTranscript(result.videoId, item.section, item.lecture.title);
            } else {
                console.error(`Could not extract video ID or video failed for ${item.lecture.id}`);
            }
        }

        return true;
    }

    async watchLecture(url: string): Promise<{ videoId: string | null }> {
        if (!this.page) return { videoId: null };

        let videoId: string | null = null;

        // Intercept VTT/HLS request
        const requestHandler = (request: HTTPRequest) => {
            if (videoId) return; // Already found, stop processing/spamming

            const reqUrl = request.url();
            const match = reqUrl.match(/\/video\/([^\/]+)\/hls\//);
            if (match && match[1]) {
                videoId = match[1];
                console.log(`INTERCEPTED: Found Video ID: ${videoId}`);
            }
        };

        this.page.on('request', requestHandler);

        console.log(`Navigating to lecture...`);
        // Increased timeout to 60s to avoid transient network timeouts
        await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Attempt to play and mute video
        const played = await this.playAndMuteVideo();

        if (!played) {
            console.log("Could not find or play video.");
            this.page.off('request', requestHandler);
            return { videoId };
        }

        // Wait for ID
        let attempts = 0;
        while (!videoId && attempts < 20) {
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
        }

        if (videoId) {
            console.log('Video ID found. Watching until finished...');
            await this.waitForVideoToFinish();
        }

        this.page.off('request', requestHandler);
        return { videoId };
    }

    async playAndMuteVideo(): Promise<boolean> {
        if (!this.page) return false;

        // Wait for frames to load
        await new Promise(r => setTimeout(r, 3000));

        const frames = this.page.frames();
        for (const frame of frames) {
            const url = frame.url();
            if (url.includes('hotmart') || url.includes('wistia') || url.includes('player')) {
                try {
                    console.log(`Found player frame: ${url}`);

                    // 1. Reset video to start and mute
                    await frame.evaluate(() => {
                        const v = document.querySelector('video');
                        if (v) {
                            v.currentTime = 0;  // Reset to beginning
                            v.muted = true;
                        }
                    });
                    console.log("Video reset to start and muted.");

                    // 2. Check initial state
                    const initialState = await frame.evaluate(() => {
                        const v = document.querySelector('video');
                        if (!v) return null;
                        return {
                            paused: v.paused,
                            currentTime: v.currentTime,
                            duration: v.duration,
                            readyState: v.readyState
                        };
                    });

                    if (!initialState) {
                        console.error("Video element not found in frame.");
                        continue;
                    }

                    console.log(`Initial state: paused=${initialState.paused}, duration=${initialState.duration}s, readyState=${initialState.readyState}`);

                    // 3. If paused, try to play
                    if (initialState.paused) {
                        console.log("Video is paused. Attempting to play...");

                        // Try JS play first
                        await frame.evaluate(() => {
                            const v = document.querySelector('video');
                            if (v) v.play().catch(e => console.error('Play error:', e));
                        });

                        await new Promise(r => setTimeout(r, 1000));

                        // Verify playback started
                        const afterPlayState = await frame.evaluate(() => {
                            const v = document.querySelector('video');
                            if (!v) return null;
                            return {
                                paused: v.paused,
                                currentTime: v.currentTime
                            };
                        });

                        if (afterPlayState && afterPlayState.paused) {
                            console.log("JS play failed. Trying to click play button...");
                            // Try clicking play button in control bar
                            const playBtn = await frame.$('button[aria-label*="Play"]');
                            if (playBtn) {
                                await frame.evaluate((b) => b.click(), playBtn);
                                await new Promise(r => setTimeout(r, 1000));
                            }
                        }
                    }

                    // 4. Final verification
                    const finalState = await frame.evaluate(() => {
                        const v = document.querySelector('video');
                        if (!v) return null;
                        return {
                            paused: v.paused,
                            currentTime: v.currentTime,
                            duration: v.duration,
                            muted: v.muted
                        };
                    });

                    if (finalState) {
                        console.log(`Final state: playing=${!finalState.paused}, currentTime=${finalState.currentTime}s, duration=${finalState.duration}s, muted=${finalState.muted}`);
                        if (!finalState.paused) {
                            console.log("✓ Video is playing from the start.");
                            return true;
                        } else {
                            console.warn("⚠ Video is still paused after play attempts.");
                        }
                    }



                    return true;
                } catch (e) {
                    console.error("Error in playAndMuteVideo:", e);
                }
            }
        }
        return false;
    }

    async waitForVideoToFinish(): Promise<void> {
        if (!this.page) return;

        console.log("Waiting for video to finish...");

        const checkInterval = 2000;
        const maxWait = 3600 * 1000; // 1 hour max
        let waited = 0;
        let videoDuration: number | null = null;

        while (waited < maxWait) {
            let finished = false;
            const frames = this.page.frames();
            for (const frame of frames) {
                const url = frame.url();
                if (url.includes('hotmart') || url.includes('wistia') || url.includes('player')) {
                    // Get current state
                    const state = await frame.evaluate(() => {
                        const player = document.querySelector('.video-js');
                        const v = document.querySelector('video');
                        if (!v) return null;

                        return {
                            ended: player && player.classList.contains('vjs-ended'),
                            currentTime: v.currentTime,
                            duration: v.duration,
                            paused: v.paused
                        };
                    });

                    if (!state) continue;

                    // Log duration once
                    if (videoDuration === null && state.duration > 0) {
                        videoDuration = state.duration;
                        console.log(`Video duration: ${Math.floor(videoDuration / 60)}m ${Math.floor(videoDuration % 60)}s`);
                    }

                    // Check if finished
                    const timeCheck = state.duration > 0 && state.currentTime >= state.duration - 1;
                    if (state.ended || timeCheck) {
                        finished = true;
                        break;
                    }

                    // Log progress every 30s
                    if (waited % 30000 === 0 && videoDuration) {
                        const progress = (state.currentTime / videoDuration * 100).toFixed(1);
                        console.log(`Still watching... ${Math.floor(state.currentTime)}s / ${Math.floor(videoDuration)}s (${progress}%) - paused: ${state.paused}`);
                    }
                }
            }

            if (finished) {
                console.log("Video finished playing.");
                return;
            }

            await new Promise(r => setTimeout(r, checkInterval));
            waited += checkInterval;
        }
        console.log("Timed out waiting for video to finish.");
    }

    async generateTranscript(videoId: string, sectionTitle: string, lectureTitle: string): Promise<boolean> {
        const cleanSection = sectionTitle.replace(/[<>:"/\\|?*]/g, '_').trim();
        const cleanLecture = lectureTitle.replace(/[<>:"/\\|?*]/g, '_').trim();
        // Point to root data/transcripts directory
        const transcriptsDir = path.join(__dirname, '..', '..', 'data', 'transcripts');
        const outputPath = path.join(transcriptsDir, cleanSection, `${cleanLecture}.txt`);

        // Path to Python script (relative to src: ../../fastapi/src/make_transcripts.py)
        const fastapiDir = path.join(__dirname, '..', '..', 'fastapi');
        const scriptPath = path.join(fastapiDir, 'src', 'make_transcripts.py');
        // Use uv run in the fastapi directory so it picks up the environment
        const command = `uv run python "${scriptPath}" --video-id "${videoId}" --output "${outputPath}"`;

        console.log(`Generating Transcript...`);
        try {
            const { stdout, stderr } = await execPromise(command, { cwd: fastapiDir });
            // Check if success (simple check, stdout usually contains "saved to")
            if (stdout.includes('saved to')) console.log('Transcript Saved.');
            else console.log(stdout);
            return true;
        } catch (error) {
            console.error(`Error running make_transcripts: ${error}`);
            return false;
        }
    }
}

// CLI Execution
async function main() {
    const args = process.argv.slice(2);

    // Parse args
    let targetSession: string | undefined = undefined;
    const sessionIdx = args.indexOf('--session');
    if (sessionIdx !== -1) targetSession = args[sessionIdx + 1];

    let batchSize = 1;
    const batchIdx = args.indexOf('--batch-size');
    if (batchIdx !== -1) batchSize = parseInt(args[batchIdx + 1]);

    const automator = new Player({
        debug: args.includes('--debug'),
        headless: !args.includes('--debug'),
        email: process.env.EMAIL,
        password: process.env.PASSWORD,
        courseId: process.env.COURSE_ID || '1820301',
        proxy: process.env.PROXY,
        targetSession: targetSession,
        batchSize: batchSize
    });

    const success = await automator.run();
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main().catch(console.error);
}
