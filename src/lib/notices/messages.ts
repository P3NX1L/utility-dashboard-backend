import type { FiveDayTenant, AccessTenant } from "./types";
import { fieldValues } from "./templates";

export interface MessageDraft { subject: string; email: string; sms: string }

const DRAFT_NOTE = "[DRAFT wording — replace with approved office template]";

export function defaultFiveDayMessage(t: FiveDayTenant): MessageDraft {
  const v = fieldValues("five-day", t);
  return {
    subject: `Notice regarding ${v['addressLine']}`,
    email: `${DRAFT_NOTE}\n\nDear ${v['names']},\n\nOn ${v['issueDateLong']}, a 5-day notice was issued for ${v['addressLine']}. The balance due is ${v['balanceNumeric']} (${v['balanceWords']}\n\nPlease contact the First Western office with any questions.\n\nFirst Western, on behalf of ${v['llc']}`,
    sms: `${DRAFT_NOTE} First Western: A 5-day notice dated ${v['issueDateLong']} was issued for ${v['addressLine']}. Balance due: ${v['balanceNumeric']}. Please contact our office.`,
  };
}

export function defaultAccessMessage(t: AccessTenant): MessageDraft {
  const v = fieldValues("access", t);
  return {
    subject: `Scheduled entry at ${v['addressLine']}`,
    email: `${DRAFT_NOTE}\n\nDear ${v['names']},\n\nThis is notice that First Western staff or vendors will enter ${v['addressLine']} on: ${v['entryDatesLong']}.\nReason: ${v['reason']}\n\nPlease contact the office if you have questions.\n\nFirst Western`,
    sms: `${DRAFT_NOTE} First Western: We plan to enter ${v['addressLine']} on ${v['entryDatesLong']} for: ${v['reason']}. Questions? Contact our office.`,
  };
}
