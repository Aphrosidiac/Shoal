import type { Kind } from '../store/repo/queue.js'

export type ExplorePayload = { pageId?: number; path?: string; why: string }
export type FormPayload = { formId: number; fieldId: number; valueClass: string; path: string }
export type MissionPayload = { goal: string; success: string; persona: string; fresh: boolean }
export type HammerPayload = { endpointId: number; shape: 'same-row' | 'shared-resource' | 'cross-action'; partnerId?: number }
export type ConfirmPayload = { suspicionId: number }
export type CrossAccountPayload = { recordingId: number; accountId: number }

export type Payloads = {
  explore: ExplorePayload
  form: FormPayload
  mission: MissionPayload
  hammer: HammerPayload
  confirm: ConfirmPayload
  crossaccount: CrossAccountPayload
}

export const KINDS: Kind[] = ['confirm', 'explore', 'form', 'mission', 'crossaccount', 'hammer']

/** Which worker pool may take which kind. */
export const EXPLORER_KINDS: Kind[] = ['explore', 'form', 'mission']
export const HAMMERER_KINDS: Kind[] = ['hammer', 'crossaccount']
export const CONFIRMER_KINDS: Kind[] = ['confirm']

/** Only three of the six cost a model call. The two that dominate a long run
 *  — hammer and confirm — are free, which is why hour twenty is cheap. */
export const COSTS_MODEL: Record<Kind, boolean> = {
  explore: true, form: true, mission: true, hammer: false, confirm: false, crossaccount: false,
}
