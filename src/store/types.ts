export interface Frame {
  id: string;
  topic: string;
  context_id: string;
  hash?: string;
  meta?: Record<string, any>;
}

export interface AppendRequest {
  topic: string;
  content: string;
  meta?: Record<string, any>;
}

export interface EventStreamInterface {
  // Append a new event
  appendEvent(request: AppendRequest): Promise<string>;
  
  // Get content from CAS by hash
  getCasContent(hash: string): Promise<string>;
  
  // Listen for new frames
  onFrame(callback: (frame: Frame) => void): () => void;
}