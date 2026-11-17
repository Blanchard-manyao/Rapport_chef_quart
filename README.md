# Rapport Chef de Quart — JavaScript / Electron

Les équipes peuvent créer leurs rapports et consulter l’historique, y compris les détails des arrêts et les synthèses de quart. Le tableau de bord, les rapports enregistrés, l’analyse des arrêts et les exports sont réservés à l’administrateur.

La synthèse s’affiche après l’enregistrement d’un rapport. Sa capture PNG peut être enregistrée dans `Documents\RapportQuart\Captures`; les captures d’équipe sont séparées dans un sous-dossier dédié et chaque équipe ne peut capturer que ses propres rapports. Le formulaire affiche toutes ses sections sur une seule page, dans l’ordre : Quart, Effectif, Prélavage, Granulation, Séchoirs, Conditionnement, Générateurs et Autres arrêts. Les titres sont agrandis. L’aperçu « Rapport à copier » reste à droite sur grand écran et passe sous le formulaire sur petit écran. Les compteurs Brûleur 1 et Brûleur 2 sont limités à 130. Une confirmation est demandée avant chaque déconnexion.

## Organisation du code

- `src/principal.js` — processus principal Electron : fenêtre, connexion, données partagées, validations et exports.
- `src/prechargement.js` — liste en français les méthodes autorisées entre l’interface et Electron.
- `src/metier.js` — règles métier : calculs de production, durées d’arrêt, validation et lignes de synthèse.
- `src/formulaire-rapport.js` — formulaire de saisie sur une page, contrôles d’heures et aperçu du texte à copier.
- `src/interface.js` — écrans, navigation, filtres, tableau de bord, historique et export des rapports.
- `src/styles.css` — mise en page et adaptation aux tailles d’écran.

Les noms des fichiers, des fonctions, des principales variables, des classes CSS, des identifiants HTML, des attributs de formulaire et des méthodes exposées à l’interface sont en français. Les clés enregistrées dans la base et les canaux IPC restent inchangés pour conserver la compatibilité. Les exports Excel reprennent la date ou la plage choisie dans le filtre.

## Lancer en développement

1. Installer Node.js LTS.
2. Dans ce dossier, ouvrir PowerShell et exécuter `npm install`.
3. Lancer `npm start`.

## Installer sous Windows

L’installateur NSIS et le ZIP portable se trouvent dans `dist`. Pour les reconstruire, exécuter `npm run dist`. L’installateur est non signé et permet de choisir son dossier d’installation.

## Comptes et sécurité

Au premier lancement, notez la clé de récupération affichée. Elle est requise pour initialiser le compte administrateur et peut réinitialiser les mots de passe d’équipe. Elle n’est pas affichée dans le formulaire de connexion. Le premier accès de chaque équipe initialise son mot de passe. Après cinq échecs, la connexion est bloquée pendant 15 minutes. Les mots de passe sont hachés avec un sel aléatoire et PBKDF2.

Les données locales sont chiffrées par Windows via Electron `safeStorage` lorsqu’il est disponible. Une sauvegarde quotidienne est conservée avec une rétention de 30 fichiers. Les rapports et l’historique ne sont pas supprimés par l’application.

## Import de l’ancienne base C#

Au premier accès administrateur, l’application détecte et importe automatiquement `C:\ProgramData\RapportQuart\rapports_quart.db` (ou le dossier défini par `RAPPORT_QUART_DONNEES`). L’import lit les fichiers SQLite en clair et les bases SQLCipher de l’ancien programme (avec `cle.dat`, déchiffré par DPAPI Windows). Il importe les rapports, les relevés séchoirs, les arrêts, les générateurs et les mots de passe des équipes. Les rapports ayant le même identifiant sont ignorés ; la base source n’est jamais modifiée.

Les données sont conservées dans le dossier utilisateur d’Electron. Les exports de rapports et de temps d’arrêt sont des fichiers `.xlsx`.

## Base de données JavaScript

La version JavaScript utilise une base SQLCipher 4 nommée `rapport-cq.db`, située dans `%APPDATA%\rapport-cq-js`. Ouvre-la avec **DB Browser for SQLCipher** (et non l’édition SQLite seule), sélectionne SQLCipher 4 et saisis la phrase secrète SQLCipher de cette installation. Ferme l’application avant de modifier les données dans DB Browser ; les rapports sont dans la table `reports` et leur contenu détaillé est conservé dans `payload_json`.

## Portail administrateur distant (Vercel)

Le portail web est à la racine du projet et son API se trouve dans `api/admin.mjs`. Vercel héberge l’application et Supabase fournit PostgreSQL via son API REST. La clé `service_role` est utilisée uniquement côté serveur et ne doit jamais être publiée dans le navigateur. La base locale reste la référence. Depuis l’application Windows, connectez-vous comme administrateur local puis choisissez **Synchroniser rapport**. Saisissez l’identifiant et le mot de passe du portail pour envoyer les rapports par lots via HTTPS. Ces identifiants ne sont pas enregistrés sur le poste. Les rapports portant le même identifiant sont actualisés dans Supabase.

1. Créer un projet Supabase et exécuter `database/schema.sql` dans son SQL Editor.
2. Importer le dépôt GitHub dans Vercel (Root Directory : `.`) et ajouter les variables `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` depuis les paramètres API du projet Supabase.
3. Générer l’empreinte du mot de passe avec `node scripts/hacher-mot-de-passe-admin.js` depuis un terminal privé.
4. Définir dans Vercel : `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (empreinte générée) et `SESSION_SECRET` (au moins 32 octets aléatoires encodés en hexadécimal). Redéployer après l’ajout des variables.
5. Ouvrir l’URL Vercel pour accéder à la page d’administration.

Les mots de passe ne sont pas enregistrés en clair. Les sessions utilisent un cookie `HttpOnly`, `Secure` et `SameSite=Strict`, et cinq échecs de connexion verrouillent l’identifiant et l’adresse source pendant 15 minutes.
