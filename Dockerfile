# Works on Fly.io, Railway, Koyeb, a VPS… anything that runs containers.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
