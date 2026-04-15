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
