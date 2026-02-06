# Configuration Email pour GameForge AI

## Étape 1: Configurer Gmail pour l'envoi d'emails

### Option A: Utiliser Gmail avec App Password (Recommandé)

1. **Activer la vérification en 2 étapes** sur votre compte Gmail
2. **Générer un App Password**:
   - Allez sur: https://myaccount.google.com/apppasswords
   - Sélectionnez "App" → "Autre (nom personnalisé)"
   - Donnez un nom (ex: "GameForge AI")
   - Copiez le mot de passe généré (16 caractères)

### Option B: Utiliser un service SMTP professionnel

Remplacez simplement les variables d'environnement ci-dessous.

## Étape 2: Configurer les variables d'environnement

Créez un fichier `.env` dans le dossier `gameforge-backend`:

```env
# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=votre-email@gmail.com
EMAIL_PASS=votre-app-password-16-caractères
FRONTEND_URL=http://localhost:3000
```

## Étape 3: Variables requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `EMAIL_HOST` | Serveur SMTP | `smtp.gmail.com` |
| `EMAIL_PORT` | Port SMTP | `587` |
| `EMAIL_USER` | Votre email | `votre-email@gmail.com` |
| `EMAIL_PASS` | App Password | `abcd efgh ijkl mnop` |
| `FRONTEND_URL` | URL frontend | `http://localhost:3000` |

## Étape 4: Démarrer le backend

```bash
npm run start:dev
```

## Étape 5: Tester l'envoi d'email

1. Lancez l'application Flutter
2. Allez sur l'écran de connexion
3. Cliquez sur "Forgot Password?"
4. Entrez votre email
5. Vérifiez votre boîte de réception

## Templates d'emails

### Email de reset de mot de passe
- Sujet: "Password Reset Request - GameForge AI"
- Contenu: Bouton de reset avec lien de 1 heure d'expiration

### Email de vérification
- Sujet: "Verify Your Email - GameForge AI"  
- Contenu: Bouton de vérification avec lien de 24h d'expiration

## Dépannage

### "Greeting undefined" ou erreurs similaires
- Vérifiez que toutes les variables d'environnement sont définies
- Redémarrez le backend après avoir modifié le `.env`

### Emails non reçus
- Vérifiez le dossier spam/indésirables
- Assurez-vous que l'App Password est correct
- Vérifiez les logs du backend pour les erreurs

### Erreur d'authentification SMTP
- Assurez-vous d'utiliser un App Password (pas votre mot de passe normal)
- Vérifiez que la vérification en 2 étapes est activée

## Sécurité

- **Ne jamais** commit le fichier `.env` dans Git
- **Ne jamais** partager votre App Password
- **Utilisez** des emails spécifiques à l'application pour la production
- **Considérez** utiliser un service comme SendGrid pour la production
