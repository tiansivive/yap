FROM node:22-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.9.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN HUSKY=0 pnpm install --frozen-lockfile

COPY . .
RUN pnpm nearley && pnpm build

EXPOSE 8080

CMD ["node", "lib/scripts/cli.js", "explore", "--port", "8080"]
