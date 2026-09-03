# Third-party notices

## Cloudflare network globe artwork

The following locally vendored image assets are published on the [Cloudflare Global Network](https://www.cloudflare.com/network/) page:

- `src/client/assets/cloudflare-network-globe.png`
- `src/client/assets/cloudflare-network-globe-dark.png`

Copyright Cloudflare, Inc. These artwork files are used as the non-WebGL fallback for Cloudflare's network in the Load Lab demo and are not covered by this repository's MIT license.

## Geographic data

The interactive globe's land points are generated from [Natural Earth](https://www.naturalearthdata.com/) 1:110m land polygons, which are in the public domain.

Cloudflare location codes are matched to coordinates from [OurAirports](https://ourairports.com/data/), whose data is dedicated to the public domain. The set of current location codes was derived from [`cloudflare-server-locations`](https://github.com/illusionaries/cloudflare-server-locations), distributed under the MIT License:

> MIT License
>
> Copyright (c) 2026 嘉
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Three.js

The WebGL globe uses [three.js](https://threejs.org/), distributed under the MIT License.

## Grafana k6

The Container image includes an unmodified Grafana k6 binary distributed under AGPL-3.0. See [`generator/NOTICE`](generator/NOTICE) for the pinned image and source information.
