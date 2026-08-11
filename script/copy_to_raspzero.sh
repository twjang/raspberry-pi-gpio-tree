#!/bin/bash

ROOT="$(realpath $(dirname $0)/..)"
echo $ROOT

DBG_TARGET="$ROOT/target/aarch64-unknown-linux-musl/debug/gpio_lighttree"
PRD_TARGET="$ROOT/target/aarch64-unknown-linux-musl/release/gpio_lighttree"
TARGETHOST=${TARGETHOST:-nyamnyam@192.168.0.179}

if [ -e "$PRD_TARGET" ]; then
    scp "$PRD_TARGET" "$TARGETHOST:/home/nyamnyam/gpio_lighttree"
    if [ $? -eq  0 ]; then
        echo copied $DBG_TARGET
        exit 0
    else
        echo failed to copy $DBG_TARGET
        exit 1
    fi
fi

if [ -e "$DBG_TARGET" ]; then
    echo scp "$DBG_TARGET" "$TARGETHOST:/home/nyamnyam/gpio_lighttree"
    if [ $? -eq  0 ]; then
        echo copied $DBG_TARGET
        exit 0
    else
        echo failed to copy $DBG_TARGET
        exit 1
    fi
fi
