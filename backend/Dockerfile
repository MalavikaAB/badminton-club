# Build stage: Java 21 + Maven
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
# pre-fetch dependencies (-U ignores any stale cached artifact index)
RUN mvn -B -U dependency:go-offline
# log the resolved Spring Framework versions so failures are easy to diagnose
RUN mvn -B dependency:tree -Dincludes=org.springframework:spring-web,org.springframework:spring-webmvc,org.springframework:spring-core
COPY src ./src
RUN mvn -B clean package -DskipTests

# Runtime stage: minimal JRE
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENV SERVER_PORT=8080
ENTRYPOINT ["java", "-jar", "app.jar"]