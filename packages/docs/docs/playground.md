---
sidebar_position: 4
title: Playground interactif
---

import ApiPlayground from '@site/src/components/ApiPlayground';

# Playground interactif

Interface d'exécution en direct de requêtes HTTP sur un serveur backend local ou sur le serveur mock WaslPay.

<ApiPlayground />

## Configuration et prérequis

- **Serveur backend** : Assurez-vous que votre application (`http://localhost:8000`) ou le mock WaslPay (`http://localhost:4004`) est démarré.
- **Politique CORS** : En cas d'erreur `Failed to fetch`, vérifiez que votre backend autorise les requêtes Cross-Origin (middleware CORS actif sur votre serveur local).

