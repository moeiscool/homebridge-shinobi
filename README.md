# homebridge-shinobi
> A [Homebridge](https://github.com/nfarina/homebridge) plugin integrating [Shinobi](https://shinobi.video) for motion detector cameras

# Installation
1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin: `npm install -g homebridge-shinobi`
3. Update your `config.json` configuration file

# Configuration
Example `config.json` entry:

```
"platforms": [
    {
        "baseUrl": "http:/x.x.x.x:8080",
        "apiKey": "xxx",
        "groupKey": "yyy",
        "monitors": [
            "abc",
            "def"
        ]
    }
]
```
Where:

* `baseUrl` is the base URL for the [Shinobi API](https://shinobi.video/docs/api)
* `apiKey` is a permanent Shinobi API key (configured in the Shinobi dashboard API menu)
* `groupKey` is a Shinobi group key
* `monitors` contains a list of Monitor IDs

# Help etc.

If you have a query or problem, raise an issue in GitHub, or better yet submit a PR!

