import { createContext, useContext, type ReactNode } from "react";
const ExportSession = createContext<string | null>(null);
export function ExportSessionProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <ExportSession.Provider value={userId}>{children}</ExportSession.Provider>;
}
export const useExportUser = () => useContext(ExportSession);
