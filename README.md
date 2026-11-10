# Rapport Chef de Quart — JavaScript / Electron

Les équipes peuvent créer leurs rapports et consulter l’historique, y compris les détails des arrêts et les synthèses de quart. Le tableau de bord, les rapports enregistrés, l’analyse des arrêts et les exports sont réservés à l’administrateur.

La synthèse s’affiche après l’enregistrement d’un rapport. Sa capture PNG peut être enregistrée dans `Documents\RapportQuart\Captures`; les captures d’équipe sont séparées dans un sous-dossier dédié et chaque équipe ne peut capturer que ses propres rapports. Le formulaire de saisie occupe le plein écran, avec l’aperçu « Rapport à copier » sous les onglets. Les compteurs Brûleur 1 et Brûleur 2 sont limités à 130. Une confirmation est demandée avant chaque déconnexion.

## Organisation du code

- `src/main.js` — processus principal Electron : fenêtre, connexion, données partagées, validations et exports.
- `src/preload.js` — liste les échanges autorisés entre l’interface et Electron.
- `src/domain.js` — règles métier : calculs de production, durées d’arrêt, validation et lignes de synthèse.
- `src/report-form.js` — formulaire de saisie, onglets, contrôles d’heures et aperçu du texte à copier.
- `src/renderer.js` — écrans, navigation, filtres, tableau de bord, historique et export des rapports.
- `src/style.css` — mise en page et adaptation aux tailles d’écran.

Les noms et commentaires des fonctions indiquent en français le rôle de chaque partie. Les exports Excel reprennent la date ou la plage choisie dans le filtre.

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
