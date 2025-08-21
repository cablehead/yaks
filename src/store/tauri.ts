import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EventStreamInterface, Frame, AppendRequest } from "./types";

// Override console.log to also send to Tauri backend
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => {
  originalConsoleLog(...args);
  // Also send to Tauri backend (optional)
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  invoke('log_message', { level: 'info', message }).catch(() => {});
};

console.error = (...args) => {
  originalConsoleError(...args);
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  invoke('log_message', { level: 'error', message }).catch(() => {});
};

export class TauriEventStream implements EventStreamInterface {
  async appendEvent(request: AppendRequest): Promise<string> {
    return await invoke<string>("append_event", { request });
  }

  async getCasContent(hash: string): Promise<string> {
    return await invoke<string>("get_cas_content", { hash });
  }

  onFrame(callback: (frame: Frame) => void): () => void {
    console.log("Setting up frame listener...");
    const unlisten = listen<Frame>("frame", (event) => {
      console.log("Received frame event:", event.payload);
      callback(event.payload);
    });
    
    // Return cleanup function
    return () => {
      console.log("Cleaning up frame listener");
      unlisten.then(fn => fn());
    };
  }
}