export interface Source {
  name?: string;
  fetchTracks?: () => Promise<any[]>;
  start?: () => void;
  stop?: () => void;
  [key: string]: any;
}
