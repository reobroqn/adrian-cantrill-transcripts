import type { Page } from "puppeteer";

export interface Lecture {
    id: string;
    title: string;
    url: string;
}

export interface Section {
    section_title: string;
    lectures: Lecture[];
}

export interface Manifest {
    sections: Section[];
}

export interface IPlatform {
    name: string;
    login(page: Page): Promise<boolean>;
    scrapeCourse(page: Page, courseId: string): Promise<Manifest>;
    isLoggedIn(page: Page): Promise<boolean>;
}
