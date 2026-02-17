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
    course_id: string;
    sections: Section[];
}

export interface VideoIdAndFilename {
    videoId: string | null;
    filename: string | null;
}

export interface VttSegment {
    timeRange: string;
    content: string;
    contentId?: string;
}
