"use strict";

const { pbkdf2Sync, randomBytes } = require("node:crypto");
const { stdin, stdout } = require("node:process");

function demanderMotDePasse() {
  if (!stdin.isTTY || !stdin.setRawMode)
    throw new Error("Exécutez ce script dans un terminal interactif.");

  return new Promise((resolve, reject) => {
    let password = "";
    stdout.write("Mot de passe administrateur (8 caractères minimum) : ");
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();

    const terminer = (erreur) => {
      stdin.off("data", lireCaractere);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (erreur) reject(erreur);
      else resolve(password);
    };

    const lireCaractere = (caractere) => {
      if (caractere === "\u0003") return terminer(new Error("Saisie annulée."));
      if (caractere === "\r" || caractere === "\n") return terminer();
      if (caractere === "\u007f" || caractere === "\b") {
        if (password.length) {
          password = password.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }
      if (caractere >= " " && caractere !== "\u007f") {
        password += caractere;
        stdout.write("*");
      }
    };

    stdin.on("data", lireCaractere);
  });
}

(async () => {
  let password;
  try {
    password = await demanderMotDePasse();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (password.length < 8 || password.length > 128) {
    console.error("Le mot de passe doit contenir entre 8 et 128 caractères.");
    process.exitCode = 1;
    return;
  }
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex");
  console.log(`pbkdf2-sha256$310000$${salt}$${hash}`);
})();
