ARG POSTGRES_BASE_IMAGE=postgres@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15
FROM ${POSTGRES_BASE_IMAGE} AS build

ARG PGVECTOR_COMMIT=778dacf20c07caf904557a88705142631818d8cb
ARG PGVECTOR_SOURCE_SHA256=4c33cf053329784ba6d992d05c9588b93789e907a7511f20ff5a5a5b8a0703c1
RUN apk add --no-cache build-base \
    && wget -O /tmp/pgvector.tar.gz "https://codeload.github.com/pgvector/pgvector/tar.gz/${PGVECTOR_COMMIT}" \
    && echo "${PGVECTOR_SOURCE_SHA256}  /tmp/pgvector.tar.gz" | sha256sum -c - \
    && mkdir /build \
    && tar -xzf /tmp/pgvector.tar.gz -C /build --strip-components=1 \
    && cd /build \
    && make -j2 OPTFLAGS="" with_llvm=no \
    && make install OPTFLAGS="" with_llvm=no DESTDIR=/extension

FROM ${POSTGRES_BASE_IMAGE}
COPY --from=build /extension/usr/local/ /usr/local/
