# send2ereader

A self hostable service for sending ebooks to a Kobo or Kindle ereader through the built-in browser.

## Getting Started

### Using Docker

A container image is automatically built and published on every commit, so there's no need to build it yourself.

You need [Docker](https://www.docker.com/) installed (and [docker-compose](https://docs.docker.com/compose/) if you want to use the compose file)

After you deploy, you can access the services via HTTP (http://localhost:3001)


**Docker Run**

```
docker run -d --name send2ereader --hostname send2ereader --restart unless-stopped -p 3001:3001 ghcr.io/gcaguilar/send2ereader:latest
```

**Docker Compose**

1. Create a folder and cd into it

```
mkdir send2ereader && cd send2ereader
```

2. Download the [compose file](https://github.com/gcaguilar/send2ereader/blob/master/docker-compose.yaml)

```
wget https://raw.githubusercontent.com/gcaguilar/send2ereader/refs/heads/master/docker-compose.yaml
```

3. Deploy it

```
docker compose up -d
```

### Build the image

1. Clone the repo

```
git clone https://github.com/gcaguilar/send2ereader.git && cd send2ereader
```

2. Uncomment the build section in the compose file


3. Build the image

```
docker compose build
```

4. Run container
```
docker compose up -d
```


### On your host OS

1. Install Node.js 20 or 22
2. Install this service's dependencies by running `npm install`
3. Install [Kepubify](https://github.com/pgaskin/kepubify), and have the kepubify executable in your PATH.
4. Install [KindleGen](http://web.archive.org/web/*/http://kindlegen.s3.amazonaws.com/kindlegen*), and have the kindlegen executable in your PATH.
5. Install [pdfCropMargins](https://github.com/abarker/pdfCropMargins), and have the pdfcropmargins executable in your PATH.
6. Start this service by running: `$ npm start` and access it on HTTP port 3001
