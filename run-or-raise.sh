#!/bin/bash
wmctrl -x -a "$1" || $2
