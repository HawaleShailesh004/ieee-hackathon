# lane-service plus the built web app. Build context is the repository root (see docker-compose.yml).
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY lane/package.json lane/package-lock.json lane/
RUN cd lane && npm ci --omit=dev
COPY lane/src lane/src
COPY citizen-lane-ig/fsh-generated/resources/Questionnaire-CitizenStreamAssessmentOah.json citizen-lane-ig/fsh-generated/resources/
COPY fhir-packages/oah-example-data.json fhir-packages/
COPY scripts/seed.mjs scripts/
COPY --from=web /app/web/dist web/dist
ENV HOST=0.0.0.0 PORT=8090 \
    FHIR_CITY_URL=http://fhir-city:8080/fhir FHIR_HEALTH_URL=http://fhir-health:8080/fhir
EXPOSE 8090
# Seeding is idempotent (PUT by id), so it is safe on every start.
CMD ["sh", "-c", "node scripts/seed.mjs && node scripts/seed.mjs --health && exec node lane/src/server.mjs"]
