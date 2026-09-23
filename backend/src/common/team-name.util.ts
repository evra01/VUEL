/// Comparaison tolérante aux accents/casse/espaces et aux formulations
/// partielles (ex: le club peut apparaître tronqué ou avec un tag de clan
/// devant/derrière). Utilisée à la fois par l'analyse OCR automatique
/// (OcrProcessor) et par l'arbitrage manuel sur Telegram
/// (TelegramCommandsService) — les deux canaux de vérification du score
/// doivent appliquer exactement la même règle de correspondance de nom
/// d'équipe, sinon l'un pourrait accepter ce que l'autre refuse.
export function teamsMatch(detected: string, registered: string): boolean {
  const d = normalizeTeamName(detected);
  const r = normalizeTeamName(registered);
  if (!d || !r) return false;
  return d === r || d.includes(r) || r.includes(d);
}

export function normalizeTeamName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
