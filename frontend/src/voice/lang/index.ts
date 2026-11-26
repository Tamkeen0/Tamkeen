import type { VoiceLanguage } from '../language';
import type { LanguagePack } from './types';
import { en } from './en';
import { ar } from './ar';

export const PACKS: Record<VoiceLanguage, LanguagePack> = { en, ar };

export const ALL_PACKS: LanguagePack[] = Object.values(PACKS);
