FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=3000
ENV AWS_REGION=ap-south-1

EXPOSE 3000
CMD ["node", "server.js"]
