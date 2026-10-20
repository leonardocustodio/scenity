# The pinned art toolchain of the 3D scene.
#
# Blender 5.2.2: the official Linux build of blender.org, with its own Python 3.13, NumPy and the glTF exporter
# (io_scene_gltf2). blender.org gives this build for x64 only, so the image is linux/amd64. Docker on an arm64 machine
# runs it with emulation. The base image has a fixed digest and the archive has a fixed SHA-256, so each machine runs
# the same Blender. packages/assets/src/blender/run.ts builds this image and runs the Blender scripts in it. On macOS,
# run.ts uses the Blender app 5.2 of the machine when it exists.
FROM --platform=linux/amd64 debian:13-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f

ARG DEBIAN_FRONTEND=noninteractive
ARG BLENDER_VERSION=5.2.2
ARG BLENDER_SHA256=84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168

# The libraries that the Blender binary loads also in background mode (X11, OpenGL, the keyboard map).
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends ca-certificates curl xz-utils \
        libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libgl1 libegl1 > /dev/null \
    && curl -fsSL -o /tmp/blender.tar.xz \
        "https://download.blender.org/release/Blender5.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
    && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum -c - \
    && mkdir /opt/blender \
    && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && ln -s /opt/blender/blender /usr/local/bin/blender \
    && rm /tmp/blender.tar.xz \
    && apt-get purge -y -qq curl xz-utils > /dev/null \
    && apt-get autoremove -y -qq > /dev/null \
    && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="scenity-art-blender" \
      org.opencontainers.image.description="Blender 5.2.2 for the Scenity asset pipeline (@scenity/assets)"

WORKDIR /work
