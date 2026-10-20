FROM node:24-slim
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.mjs"]
