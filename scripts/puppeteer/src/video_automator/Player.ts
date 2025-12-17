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
            const videoId = await this.watchLecture(item.lecture.url);

            if (videoId) {
                console.log(`Extracted Video ID: ${videoId}`);
                await this.generateTranscript(videoId, item.section, item.lecture.title);
            } else {
                console.error(`Could not extract video ID for ${item.lecture.id}`);
            }
        }

        return true;
    }

    async watchLecture(url: string): Promise<string | null> {
        if (!this.page) return null;

        let videoId: string | null = null;

        // Intercept VTT/HLS request
        const requestHandler = (request: HTTPRequest) => {
            const reqUrl = request.url();
            const match = reqUrl.match(/\/video\/([^\/]+)\/hls\//);
            if (match && match[1]) {
                videoId = match[1];
                console.log(`INTERCEPTED: Found Video ID: ${videoId}`);
            }
        };

        this.page.on('request', requestHandler);

        console.log(`Navigating to lecture...`);
        await this.page.goto(url, { waitUntil: 'networkidle2' });

        // Attempt to play video
        await this.playVideo();

        // Wait for ID
        let attempts = 0;
        while (!videoId && attempts < 20) {
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
        }

        if (videoId) {
            console.log('Video ID found. Watching for segments...');
            // Wait for segments to be captured by mitmproxy
            // We can check if file exists or just wait
            await new Promise(r => setTimeout(r, 15000)); // 15s wait
        }

        this.page.off('request', requestHandler);
        return videoId;
    }

    async playVideo(): Promise<boolean> {
        if (!this.page) return false;

        // Try clicking iframes
        const frames = this.page.frames();
        for (const frame of frames) {
            const url = frame.url();
            if (url.includes('hotmart') || url.includes('wistia') || url.includes('player')) {
                try {
                    // Hotmart big play button
                    const btn = await frame.$('.vjs-big-play-button');
                    if (btn) {
                        await btn.click();
                        return true;
                    }
                    // Or body
                    await frame.click('body').catch(() => { });
                    return true;
                } catch (e) { }
            }
        }
        return false;
    }

    async generateTranscript(videoId: string, sectionTitle: string, lectureTitle: string): Promise<boolean> {
        const cleanSection = sectionTitle.replace(/[<>:"/\\|?*]/g, '_').trim();
        const cleanLecture = lectureTitle.replace(/[<>:"/\\|?*]/g, '_').trim();
        const outputPath = path.join('transcripts', cleanSection, `${cleanLecture}.txt`);

        // Path to Python script (relative to cwd: scripts/puppeteer)
        const scriptPath = path.join(__dirname, '..', '..', '..', 'src', 'make_transcripts.py');
        const command = `python "${scriptPath}" --video-id "${videoId}" --output "${outputPath}"`;

        console.log(`Generating Transcript...`);
        try {
            const { stdout, stderr } = await execPromise(command);
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
        proxy: "127.0.0.1:8080",
        targetSession: targetSession,
        batchSize: batchSize
    });

    const success = await automator.run();
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main().catch(console.error);
}
