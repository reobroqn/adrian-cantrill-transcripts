export interface VideoIdAndFilename {
    videoId: string | null;
    filename: string | null;
}

export interface VttResponseData {
    url: string;
    status: number;
    getContent: () => Promise<string>;
}

export interface VttSegment {
    timeRange: string;
    content: string;
    contentId?: string;
}
