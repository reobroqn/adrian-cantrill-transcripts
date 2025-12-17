import puppeteer, { Browser, Page, Protocol, HTTPRequest } from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

interface AutomatorOptions {
    debug?: boolean;
    headless?: boolean;
    email?: string;
    password?: string;
    courseId?: string;
    mode?: 'scrape' | 'play';
    batchSize?: number;
    proxy?: string;
}

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

export class TranscriptAutomator {
    private debug: boolean;
    private headless: boolean;
    private dataDir: string;
    private configDir: string;
    private manifestPath: string;
    private browser: Browser | null;
    private page: Page | null;
    private email: string;
    private password: string;
    private courseId: string;
    private mode: 'scrape' | 'play';
    private batchSize: number;
    private proxy: string | undefined;

    constructor(options: AutomatorOptions = {}) {
        this.debug = options.debug || false;
        this.headless = options.headless !== false;
        this.dataDir = path.join(__dirname, '..', 'data');
        this.configDir = path.join(__dirname, '..', 'config');
        this.manifestPath = path.join(this.dataDir, 'course_manifest.json');
        this.browser = null;
        this.page = null;
        this.email = options.email || '';
        this.password = options.password || '';
        this.courseId = options.courseId || '';
        this.mode = options.mode || 'play';
        this.batchSize = options.batchSize || 1;
        this.proxy = options.proxy;
    }

    async init(): Promise<boolean> {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

            const args = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ];

            if (this.proxy) {
                args.push(`--proxy-server=${this.proxy}`);
                // ignore cert errors for mitmproxy
                args.push('--ignore-certificate-errors');
            }

            this.browser = await puppeteer.launch({
                headless: this.headless,
                devtools: this.debug,
                args: args,
                defaultViewport: {
                    width: 1920,
                    height: 1080
                }
            });

            this.page = await this.browser.newPage();

            await this.page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            );

            return true;
        } catch (error) {
            console.error('Error initializing browser:', error);
            return false;
        }
    }

    async login(): Promise<boolean> {
        try {
            if (!this.page) return false;

            if (!this.email || !this.password) {
                console.error('Email and password are required for login.');
                return false;
            }

            console.log('Navigating to login page...');
            await this.page.goto('https://sso.teachable.com/secure/212820/identity/login/password?force=true', { waitUntil: 'networkidle2' });

            console.log('Filling credentials...');
            await this.page.waitForSelector('#email', { visible: true });
            await this.page.type('#email', this.email);
            await this.page.type('#password', this.password);

            const submitSelector = 'input[type="submit"], button[type="submit"], input.btn-primary.button';
            await this.page.waitForSelector(submitSelector, { visible: true });

            console.log('Submitting login form...');
            await Promise.all([
                this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
                this.page.click(submitSelector)
            ]);

            const currentUrl = this.page.url();
            if (currentUrl.includes('sign_in')) {
                console.error('Still on sign in page. Login might have failed.');
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error during login:', error);
            return false;
        }
    }

    async scrapeCourse(): Promise<boolean> {
        if (!this.page || !this.courseId) return false;

        const courseUrl = `https://learn.cantrill.io/courses/enrolled/${this.courseId}`;
        console.log(`Navigating to course page: ${courseUrl}`);

        await this.page.goto(courseUrl, { waitUntil: 'networkidle2' });

        // Wait for course sections to load
        // Retry logic or wait for specific element
        try {
            await this.page.waitForSelector('.section-list', { timeout: 10000 });
        } catch (e) {
            console.log('Could not find .section-list, page might have different structure or not loaded.');
            return false;
        }

        // Scrape sections and lectures
        const sections = await this.page.evaluate(() => {
            const data: any[] = [];

            // Try standard structure first: div.course-section contains title and list
            const sectionContainers = document.querySelectorAll('.course-section');
            if (sectionContainers.length > 0) {
                sectionContainers.forEach(section => {
                    const titleEl = section.querySelector('.section-title');
                    let sectionTitle = titleEl?.textContent?.trim() || 'Unknown Section';
                    sectionTitle = sectionTitle.replace(/\s+/g, ' ');

                    const lectures: any[] = [];
                    const lectureElements = section.querySelectorAll('ul.section-list li.section-item');

                    lectureElements.forEach(item => {
                        const lectureId = item.getAttribute('data-lecture-id');
                        const link = item.querySelector('a.item') as HTMLAnchorElement;

                        if (lectureId && link) {
                            let title = link.querySelector('.lecture-name')?.textContent?.trim() || `Lecture ${lectureId}`;
                            title = title.replace(/\(\d+:\d+\)$/, '').trim().replace(/\s+/g, ' ');

                            lectures.push({
                                id: lectureId,
                                title: title,
                                url: link.href
                            });
                        }
                    });

                    if (lectures.length > 0) {
                        data.push({ section_title: sectionTitle, lectures: lectures });
                    }
                });
            } else {
                // Fallback: Find lists and look for preceding titles
                const lists = document.querySelectorAll('ul.section-list');
                lists.forEach(list => {
                    // Attempt to find title in previous sibling or parent's previous sibling
                    let titleEl = list.previousElementSibling;
                    // Walk back a few siblings to find something that looks like a title
                    let sectionTitle = 'Unknown Section';
                    for (let i = 0; i < 3; i++) {
                        if (titleEl && (titleEl.classList.contains('section-title') || titleEl.tagName.match(/H[1-6]/))) {
                            sectionTitle = titleEl.textContent?.trim() || sectionTitle;
                            break;
                        }
                        titleEl = titleEl?.previousElementSibling || null;
                    }

                    const lectures: any[] = [];
                    const lectureElements = list.querySelectorAll('li.section-item');
                    lectureElements.forEach(item => {
                        const lectureId = item.getAttribute('data-lecture-id');
                        const link = item.querySelector('a.item') as HTMLAnchorElement;
                        if (lectureId && link) {
                            let title = link.querySelector('.lecture-name')?.textContent?.trim() || `Lecture ${lectureId}`;
                            title = title.replace(/\(\d+:\d+\)$/, '').trim().replace(/\s+/g, ' ');
                            lectures.push({ id: lectureId, title: title, url: link.href });
                        }
                    });
                    if (lectures.length > 0) data.push({ section_title: sectionTitle, lectures: lectures });
                });
            }
            return data;
        });

        console.log(`Scraped ${sections.length} sections.`);

        // Save to manifest
        await fs.writeFile(this.manifestPath, JSON.stringify({ sections }, null, 2));
        console.log(`Manifest saved to ${this.manifestPath}`);

        return true;
    }

    async playBatch(): Promise<boolean> {
        if (!this.page) return false;

        // Load manifest
        let manifest: Manifest;
        try {
            const data = await fs.readFile(this.manifestPath, 'utf8');
            manifest = JSON.parse(data);
        } catch (e) {
            console.error('Could not load course_manifest.json. Run in "scrape" mode first.');
            return false;
        }

        // Flatten lectures with section info for easier batching
        const processingQueue: { section: string, lecture: Lecture }[] = [];
        manifest.sections.forEach(section => {
            section.lectures.forEach(lecture => {
                processingQueue.push({
                    section: section.section_title,
                    lecture: lecture
                });
            });
        });

        console.log(`Total lectures in manifest: ${processingQueue.length}`);

        // TODO: Implement logic to resume or select specific batch. 
        // For now, let's take the first N (batchSize)
        const batch = processingQueue.slice(0, this.batchSize);
        console.log(`Processing batch of ${batch.length} lectures.`);

        for (const item of batch) {
            console.log(`Processing: [${item.section}] ${item.lecture.title}`);
            const videoId = await this.watchLecture(item.lecture.url);

            if (videoId) {
                console.log(`Extracted Video ID: ${videoId}`);
                // Generate Transcript
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

        // Setup request interception to catch the VTT/HLS request containing the ID
        // Pattern: /video/([^/]+)/hls/
        const requestHandler = (request: HTTPRequest) => {
            const reqUrl = request.url();
            const match = reqUrl.match(/\/video\/([^\/]+)\/hls\//);
            if (match && match[1]) {
                videoId = match[1];
                console.log(`INTERCEPTED: Found Video ID: ${videoId}`);
            }
        };

        this.page.on('request', requestHandler);

        console.log(`Navigating to lecture: ${url}`);
        await this.page.goto(url, { waitUntil: 'networkidle2' });

        // Attempt to play video
        await this.playVideo();

        // Wait a bit for the network request to fire and for us to "watch" enough to capture segments
        let attempts = 0;
        while (!videoId && attempts < 15) {
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
        }

        if (videoId) {
            // If we found the ID, ensure playback continues for a bit to get segments
            console.log('Video ID found. Watching for segments...');

            // Speed up video if possible
            try {
                // Try to inject speed up into all video tags, including iframes if cross-origin allows (it might not)
                // For Hotmart iframe, we might be blocked from cross-origin access
                await this.page.evaluate(() => {
                    const video = document.querySelector('video');
                    if (video) video.playbackRate = 16;
                });

                // Also try frames
                for (const frame of this.page.frames()) {
                    try {
                        await frame.evaluate(() => {
                            const video = document.querySelector('video');
                            if (video) video.playbackRate = 16;
                        });
                    } catch (e) { /* ignore cross-origin errors */ }
                }
            } catch (e) {
                console.log('Could not speed up video (likely cross-origin iframe).');
            }

            // Wait for duration? Or just fixed time?
            // Since we can't reliably read duration from cross-origin iframe without complex logic,
            // and we rely on Mitmproxy seeing the VTT...
            // Usually VTT is fetched at start. If it's segment-based, we need to play.
            // Let's assume 30 seconds of play is enough to get the VTTs or key segments.
            // Or better: check if mitm_addon has created the file/folder? (Requires file check logic)

            console.log('Watching for 20 seconds...');
            await new Promise(r => setTimeout(r, 20000));
        }

        // Cleanup listener
        this.page.off('request', requestHandler);

        return videoId;
    }

    async playVideo(): Promise<boolean> {
        if (!this.page) return false;

        console.log('Attempting to play video...');

        // 1. Try generic clicks on Main Frame
        const videoSelectors = ['.w-video-wrapper', '.wistia_embed', 'video', '.video-js'];
        for (const selector of videoSelectors) {
            if (await this.page.$(selector)) {
                await this.page.click(selector).catch(() => { });
                return true;
            }
        }

        // 2. Look for Iframes (Hotmart, Wistia)
        const frames = this.page.frames();
        for (const frame of frames) {
            const url = frame.url();
            if (url.includes('hotmart') || url.includes('wistia') || url.includes('player')) {
                console.log(`Found player iframe: ${url}`);
                try {
                    // Try to click specific play buttons inside the frame
                    // Hotmart often has a big play button overlay
                    const playButtonSelectors = [
                        '.vjs-big-play-button',
                        'button[title="Play"]',
                        '.video-js' // Clicking the container often works
                    ];

                    for (const sel of playButtonSelectors) {
                        const btn = await frame.$(sel);
                        if (btn) {
                            console.log(`Clicking play button inside iframe: ${sel}`);
                            await btn.click();
                            return true;
                        }
                    }

                    // Fallback: Click the body of the iframe?
                    const body = await frame.$('body');
                    if (body) {
                        console.log('Clicking iframe body as fallback');
                        await body.click();
                        return true;
                    }
                } catch (e) {
                    console.log('Could not interact with iframe:', e);
                }
            }
        }

        return false;
    }

    async generateTranscript(videoId: string, sectionTitle: string, lectureTitle: string): Promise<boolean> {
        // Sanitize filenames
        const cleanSection = sectionTitle.replace(/[<>:"/\\|?*]/g, '_');
        const cleanLecture = lectureTitle.replace(/[<>:"/\\|?*]/g, '_');

        const outputPath = path.join('transcripts', cleanSection, `${cleanLecture}.txt`);

        // Call python script
        // Note: we need to run this from the root or adjust paths. 
        // Assuming we run 'npm start' from scripts/puppeteer, but python script is in src/
        // Adjusted path: ../../src/make_transcripts.py

        const scriptPath = path.join(__dirname, '..', '..', '..', 'src', 'make_transcripts.py');
        const command = `python "${scriptPath}" --video-id "${videoId}" --output "${outputPath}"`;

        console.log(`Executing: ${command}`);

        try {
            const { stdout, stderr } = await execPromise(command);
            if (stdout) console.log(`Python Output: ${stdout}`);
            if (stderr) console.error(`Python Error: ${stderr}`);
            return true;
        } catch (error) {
            console.error(`Error running make_transcripts: ${error}`);
            return false;
        }
    }

    async run(): Promise<boolean> {
        if (!await this.init()) return false;
        if (!await this.login()) {
            await this.cleanup();
            return false;
        }

        if (this.mode === 'scrape') {
            await this.scrapeCourse();
        } else {
            await this.playBatch();
        }

        await this.cleanup();
        return true;
    }

    async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

async function main() {
    const args = process.argv.slice(2);

    // Parse args
    const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] as 'scrape' | 'play' : 'play';
    const batchSize = args.includes('--batch-size') ? parseInt(args[args.indexOf('--batch-size') + 1]) : 1;

    const options: AutomatorOptions = {
        debug: args.includes('--debug'),
        headless: !args.includes('--debug'),
        email: process.env.EMAIL,
        password: process.env.PASSWORD,
        courseId: process.env.COURSE_ID || '1820301',
        mode: mode,
        batchSize: batchSize,
        proxy: "127.0.0.1:8080" // Defaulting to local proxy for traffic interception
    };

    const automator = new TranscriptAutomator(options);
    const success = await automator.run();
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Uncaught error:', error);
        process.exit(1);
    });
}
