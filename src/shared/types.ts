export interface VttSegment {
    timeRange: string;
    content: string;
    contentId?: string;
}

export interface Lecture {
    id: string;
    title: string;
    url: string;
}

export interface QueueItem {
    section: string;
    lecture: Lecture;
}

export interface BulkState {
    active: boolean;
    tabToIndex: { [tabId: number]: number };
    nextIndex: number;
    completedCount: number;
    queue: QueueItem[];
}

export interface IframeDetails {
    videoId: string;
    queryParams: string;
    iframeSrc: string;
}

export interface CourseSection {
    section_title: string;
    lectures: Lecture[];
}

// Extension message shapes
export type ExtensionMessage =
    | { type: "MANIFEST_EXTRACTED"; payload: CourseSection[] }
    | {
          type: "DOWNLOAD_TRANSCRIPT";
          payload: {
              videoId: string;
              filename: string;
              masterUrl?: string | null;
          };
      }
    | { type: "GET_LAST_VIDEO_ID" }
    | { type: "START_BULK_DOWNLOAD" }
    | { type: "CANCEL_BULK_DOWNLOAD" }
    | { type: "AUTOMATION_PROCESS_LECTURE"; index: number }
    | {
          type: "BULK_PROGRESS";
          payload: { completedCount: number; total: number };
      }
    | { type: "BULK_FINISHED" }
    | { type: "BULK_CANCELLED" };
