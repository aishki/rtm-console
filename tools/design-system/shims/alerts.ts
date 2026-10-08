// Preview stand-in for desktop alerts: reported as already on, so no permission prompt is offered.
export type AlertState = "unsupported" | "default" | "granted" | "denied";
export const useAlertState = (): AlertState => "granted";
export async function enableAlerts(): Promise<AlertState> { return "granted"; }
export const clearAlert = (): void => {};
