# bsn

Yet another CLI for *buaaStudentNcov*, powered by Puppeteer.

## Motivations

This implementation relys only on the DOM structure of the page, trying to be agnostic of frontend details and the request specs, hence less likely to post any malformed requests. Request interception provided by Puppeteer is useful for doing faster and more stable geolocation, without injecting scripts into AMap API.

## Requirements

- Node.js
- Chromium (optional)

## Getting Started

To use with your custom Chromium/Chrome installation, export the [environment variables](https://github.com/puppeteer/puppeteer/blob/v13.5.1/docs/api.md#environment-variables) before `npm install`:

```shell
$ export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable  # your Chromium/Chrome executable
```

Otherwise, one will be downloaded automatically during the installation.

```shell
$ npm install
$ cp config.example.json config.json
$ vi config.json  # Fill with your information
```

`config.json` must be present in the working directory. At the first run, a new file `cookies.json` will be created for caching the login cookies. **Please keep the two files confidential.**

```shell
$ node main.js
```

## Configurations

`config.json` should represent a JSON Object with the following fields:

- `username`: string
- `password`: string

The optional fields are below:

- `longitude`: string
- `latitude`: string
  - Your position in GCJ-02. If unspecified, the original AMap geolocation will be used, which can be slow and often fails.
- `check_on_campus`: boolean, defaults to `false`
  - Explicitly click the answer to the first question. Use this if simply inheriting fails to submit (usually when not on campus).
- `timeout`: number, defaults to `30000`
  - Timeout before waiting for page elements, in milliseconds.
- `browser`: object
  - Passed to [puppeteer.launch](https://github.com/puppeteer/puppeteer/blob/v13.5.1/docs/api.md#puppeteerlaunchoptions), useful for specifying `executablePath` of Chromium.
- `dry`: boolean, defaults to `false`
  - Stop before clicking the final submit button. Useful for checking the actual address of your given position.
- `hang`: boolean, defaults to `false`
  - Wait for signals rather than close the browser immediately after finished. Useful for debugging with `browser.headless` set to `false`.
- `shifted`: boolean, defaults to `false`

## For Termux (Android)

The following `browser` configuration is tested to work in [TermuxArch](https://github.com/SDRausty/termux-archlinux), a Termux proot distro:

```json
"browser": {
  "executablePath": "/usr/bin/chromium",  // provided by your distro
  "args": [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage"
  ]
}
```

[A wrapper script](termux-runner.bash) is provided for notification support (requires Termux:API), handy for usage with `cronie`.
