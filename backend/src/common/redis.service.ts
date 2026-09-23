import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

/// En dev local, si aucune variable REDIS_HOST n'est définie dans .env, ce service
/// utilise un stockage en mémoire à la place d'un vrai serveur Redis — utile pour
/// tester le backend sans installer Redis (Windows notamment). Le comportement
/// (set avec expiration, get, del) reste identique du point de vue de l'appelant.
///
/// À NE PAS utiliser en production : les données sont perdues au redémarrage du
/// process et ne sont pas partagées entre plusieurs instances du serveur. Pour la
/// prod, définis REDIS_HOST (et éventuellement REDIS_PORT) pour utiliser un vrai
/// Redis (ex: Upstash, Memurai, ou un Redis managé).
interface InMemoryEntry {
  value: string;
  expiresAt: number | null;
}

class InMemoryRedisClient {
  private store = new Map<string, InMemoryEntry>();

  private isExpired(entry: InMemoryEntry): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  async set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<'OK'> {
    const expiresAt = mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  disconnect(): void {
    this.store.clear();
  }
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public client: any;

  async onModuleInit() {
    if (!process.env.REDIS_HOST) {
      this.logger.warn(
        'REDIS_HOST non défini — utilisation d\'un store en mémoire à la place de Redis (dev uniquement, non persistant).',
      );
      this.client = new InMemoryRedisClient();
      return;
    }

    const Redis = (await import('ioredis')).default;
    this.client = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,

      // Keep-alive TCP : sans ça, une connexion inactive quelques dizaines de
      // secondes se fait couper par le NAT/firewall entre Render et le Redis
      // managé (Upstash, Redis Cloud, etc.), ce qui remonte comme
      // "read ECONNRESET" côté client — le paquet keep-alive périodique
      // évite que la connexion soit considérée comme morte.
      keepAlive: 10_000,

      // Reconnexion automatique avec backoff exponentiel plafonné plutôt que
      // de laisser ioredis abandonner — un ECONNRESET ponctuel ne doit pas
      // dégrader durablement les commandes suivantes.
      retryStrategy: (times: number) => Math.min(times * 200, 5_000),

      // Une commande en vol au moment de la coupure est automatiquement
      // rejouée après reconnexion plutôt que de rejeter immédiatement.
      maxRetriesPerRequest: 3,

      // Upstash (et les Redis managés serverless en général) facturent/
      // limitent au nombre de requêtes — le pipelining auto regroupe les
      // commandes émises dans le même tick JS en un seul aller-retour réseau
      // au lieu d'une connexion par commande.
      enableAutoPipelining: true,
    });

    // ioredis considère un listener 'error' absent comme une erreur fatale
    // Node (EventEmitter) et se contente de logguer "Unhandled error event"
    // en boucle sans jamais planter le process. On l'écoute explicitement
    // pour avoir un log exploitable (et pouvoir, plus tard, brancher une
    // alerte) plutôt que ce message générique répété à chaque coupure.
    this.client.on('error', (err: Error) => {
      this.logger.error(`Erreur de connexion Redis: ${err.message}`);
    });
    this.client.on('connect', () => this.logger.log('Connecté à Redis'));
    this.client.on('reconnecting', (delay: number) =>
      this.logger.warn(`Reconnexion à Redis dans ${delay}ms…`),
    );
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }
}
