-- Base des rapports chef de quart (usine TSR10)
-- Un rapport = 1 ligne dans rapport + 3 lignes dans sechoir_releve

CREATE TABLE equipe (
  code CHAR(1) PRIMARY KEY,
  chef TEXT NOT NULL
);

INSERT INTO equipe (code, chef) VALUES
  ('A', 'KONAN LUC'),
  ('B', 'EYO NESTOR'),
  ('C', 'DAMEY JEAN-BAPTISTE'),
  ('D', 'TIA LOU EDWIGE');

CREATE TABLE rapport (
  id TEXT PRIMARY KEY,                       -- ex. 2026-10-17_23h-07h_D
  date DATE NOT NULL,
  quart TEXT NOT NULL,                       -- 07h-15h, 15h-23h, 23h-07h
  equipe CHAR(1) NOT NULL REFERENCES equipe(code),

  -- Effectif : present = effectif_total - absent - malade - permission - conge
  effectif_total INT,
  present INT, absent INT, malade INT, permission INT, conge INT,

  -- Accident de travail
  accident INT DEFAULT 0,                    -- nombre d'accidents de travail

  -- Prélavage (total_prelave = 1500 x godets ; arrêts dans la table arret)
  box_prelave TEXT,
  godets INT,
  total_prelave INT,
  box_prelave2 TEXT,                         -- 2e box prélavé pendant le quart (facultatif)
  godets2 INT,
  total_prelave2 INT,                        -- 1500 x godets2

  -- Conditionnement
  production INT,                            -- unités
  kg INT,                                    -- production x 1260
  balles_debut INT,                          -- balles détectées : début
  balles_quart INT,                          -- pendant le quart
  balles_traitees INT,                       -- balles traitées
  balles_fin INT,                            -- fin de quart
  causes_conditionnement TEXT,

  -- Granulation
  box_usinage TEXT,
  titre_acide REAL,                       -- g/l
  conso_acide REAL,                       -- kg
  paniers_granules INT CHECK (paniers_granules BETWEEN 0 AND 999),
  avance_panier TEXT, panier_lave TEXT,      -- arrêts des lignes : table arret

  -- Séchoirs : paniers séchés (3 chiffres max). Poids moyen d'un panier = (production x 36 / paniers_seches) x 35, calculé à l'affichage
  paniers_seches INT CHECK (paniers_seches BETWEEN 0 AND 999),

  -- Séchoirs : voir sechoir_releve (relevés) et arret (pannes)

  cree_le TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (date, quart, equipe)
);

CREATE TABLE sechoir_releve (
  rapport_id TEXT NOT NULL REFERENCES rapport(id) ON DELETE CASCADE,
  sechoir INT NOT NULL CHECK (sechoir IN (1, 2, 3)),
  cycle_sec INT CHECK (cycle_sec BETWEEN 0 AND 999),                             -- cycle propre à chaque séchoir, en secondes
  bruleur1 INT CHECK (bruleur1 BETWEEN 0 AND 999),
  bruleur2 INT CHECK (bruleur2 BETWEEN 0 AND 999),
  arret_min INT,                             -- somme des arrêts (table arret)
  marche_min INT,                            -- 480 - arret_min
  compteur TEXT,                             -- compteur séchoir : saisie conservée telle quelle
  gaz TEXT,                                  -- compteur gaz : 1re valeur, saisie conservée telle quelle
  gaz2 TEXT,                                 -- compteur gaz : 2e valeur, saisie conservée telle quelle
  PRIMARY KEY (rapport_id, sechoir)
);

-- Générateurs : ne fonctionnent que pendant une coupure d'électricité
-- (heure de démarrage / heure d'arrêt = temps de fonctionnement)
CREATE TABLE generateur_marche (
  id INTEGER PRIMARY KEY,
  rapport_id TEXT NOT NULL REFERENCES rapport(id) ON DELETE CASCADE,
  generateur TEXT NOT NULL,                  -- GE 2500 KVA, GE 2000 KVA
  heure_demarrage TIME NOT NULL,
  heure_arret TIME NOT NULL
);

CREATE VIEW generateur_duree AS
SELECT rapport_id, generateur, heure_demarrage, heure_arret,
       CASE WHEN heure_arret >= heure_demarrage
            THEN (strftime('%s', heure_arret) - strftime('%s', heure_demarrage)) / 60
            ELSE (strftime('%s', heure_arret) - strftime('%s', heure_demarrage)) / 60 + 1440
       END AS duree_min
FROM generateur_marche;

-- Arrêts machine : 0 à N lignes par rapport
CREATE TABLE arret (
  id INTEGER PRIMARY KEY,
  rapport_id TEXT NOT NULL REFERENCES rapport(id) ON DELETE CASCADE,
  zone TEXT NOT NULL,                        -- Prélavage, Conditionnement, Séchoir 1-3, Ligne 1-2, Autre
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  cause TEXT,
  equipement TEXT                            -- équipement concerné (zone "Autre")
);

-- Durée des arrêts par rapport (minutes, passage de minuit géré)
CREATE VIEW arret_duree AS
SELECT rapport_id, zone,cause,
       CASE WHEN heure_fin >= heure_debut
            THEN (strftime('%s', heure_fin) - strftime('%s', heure_debut)) / 60
            ELSE (strftime('%s', heure_fin) - strftime('%s', heure_debut)) / 60 + 1440
       END AS duree_min
FROM arret;

-- Production totale par jour
CREATE VIEW production_par_jour AS
SELECT date,
       SUM(production) AS unites,
       SUM(kg) AS kg,
       SUM(balles_traitees) AS balles
FROM rapport
GROUP BY date;

-- Production totale par équipe
CREATE VIEW production_par_equipe AS
SELECT r.equipe, e.chef,
       COUNT(*) AS nb_rapports,
       SUM(r.kg) AS kg
FROM rapport r
JOIN equipe e ON e.code = r.equipe
GROUP BY r.equipe, e.chef;

-- Journal : une ligne par enregistrement de rapport (jamais modifié, jamais supprimé)
CREATE TABLE journal (
  id INTEGER PRIMARY KEY,
  date_heure TEXT NOT NULL,                  -- 2026-10-27 14:32:05
  utilisateur TEXT NOT NULL,                 -- session Windows
  action TEXT NOT NULL,                      -- CREATION, MODIFICATION
  rapport_id TEXT,                           -- ex. 2026-10-17_23h-07h_D
  detail TEXT
);