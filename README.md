# AnkiGen

[![Patreon](https://img.shields.io/badge/Patreon-support-F96854?logo=patreon&logoColor=white)](https://www.patreon.com/cw/blisstweeting)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-support-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/blisstweeting)
[![Liberapay](https://img.shields.io/badge/Liberapay-support-F6C915?logo=liberapay&logoColor=black)](https://liberapay.com/blisstweeting)
[![ENS](https://img.shields.io/badge/ENS-support-0080BC?logo=ens&logoColor=white)](https://etherscan.io/address/0x567ccDD062Ec253293B2A3C0459A86c00CdDfDbe)

Free Anki vocabulary decks in 23 languages, built in your browser: **https://xenohunter.github.io/ankigen/**

![AnkiGen](docs/screenshot.png)

Pick the language you're learning and one you speak (or same-language definitions), choose topic modules and card fields, and download an `.apkg` for Anki or AnkiDroid. Nothing is uploaded. Decks are deterministic: a newer download imports over the old deck and keeps your review history.

Languages: English, German, Dutch, Swedish; Chinese, Japanese, Vietnamese, Korean; Spanish, French, Portuguese, Italian; Russian, Polish, Ukrainian, Serbian; Irish, Scottish Gaelic; Arabic, Turkish, Greek, Hungarian and Armenian. The page itself speaks all of them, Arabic right to left.

The vocabulary is drafted by an AI model and partly reviewed by people. Spotted an error? Select it on a card and press Ctrl+Enter, or use the Feedback button.

## Development

No build step, no dependencies; Node 22 for tooling.

```
python3 -m http.server 8000   # open http://localhost:8000/ (add ?data=tests/fixtures/data for the small test set)
npm test                      # unit tests
npm run lint:data             # validate data/ (lint:fixtures: the golden sample)
node tools/bundle.mjs         # build the site into _site/, with the landing pages under decks/
```

Downloading needs `https://` or `localhost`. Every push to `master` deploys to GitHub Pages (`.github/workflows/pages.yml`); to release a data update, bump `data` in `data/meta/version.json`. Design, data format and generation are documented in [`docs/`](docs/).

## License

Code: [MIT](LICENSE). Vocabulary in `data/`: [CC BY-SA 4.0](data/LICENSE.md). `vendor/`: see [`vendor/README.md`](vendor/README.md).
