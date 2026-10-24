import { createServer, VERSION } from './app.js';
import { adminPasswordProblem } from './admin/security.js';
import { ConfigError, parseConfig } from './config.js';

const env = process.env;
let config;
let papote;
try {
  config = parseConfig(env);
  // After a restore from the admin, exit: Docker (restart: unless-stopped) starts the server again.
  papote = createServer({ ...config, restart: () => setTimeout(() => process.exit(0), 300) });
} catch (err) {
  // A bad value must stop the container, not quietly disable backups or trust the wrong proxy.
  console.error(`Configuration invalide : ${err instanceof ConfigError ? err.message : err.message}`);
  process.exit(1);
}
const { port, host } = config;

papote.server.listen(port, host, () => {
  console.log(`Papote v${VERSION} à l'écoute sur http://${host}:${port}`);
  const problem = adminPasswordProblem(config.adminPassword);
  if (problem) console.warn(`Admin web (/admin) désactivée : ${problem}`);
  if (config.trustProxy) console.log(`Reverse proxy cru pour X-Forwarded-For : ${config.trustProxy}`);
  if (env.ADMIN_ALLOWED_IPS) console.log(`Admin web limitée à : ${env.ADMIN_ALLOWED_IPS}`);
  console.log(`GIF (GIPHY) : ${config.giphyApiKey ? 'activés, via le serveur' : 'désactivés (GIPHY_API_KEY vide)'}`);
  console.log(`Transcription des vocaux : ${config.whisperUrl ? `via ${config.whisperUrl}` : 'désactivée (COMPOSE_PROFILES=whisper dans .env pour l’activer)'}`);
  papote.backups.start();
  papote.updates.start();
  console.log(config.updateCheck ? `Mises à jour : vérifiées sur github.com/${config.updateRepo}` : 'Vérification des mises à jour désactivée (UPDATE_CHECK=false)');
  console.log(
    papote.backups.everyHours
      ? `Sauvegardes automatiques toutes les ${papote.backups.everyHours} h dans ${papote.backups.dir} (${papote.backups.keep} gardées)`
      : 'Sauvegardes automatiques désactivées (BACKUP_EVERY_HOURS=0)',
  );
  const code = papote.bootstrapCode();
  if (code) console.log(`Aucun compte pour l'instant. Code d'accès pour la première personne : ${code}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    papote.close();
    process.exit(0);
  });
}
