#!/usr/bin/env bash

set -e

if [[ $LOGNAME != "www-data" ]]; then
        echo "Run as www-data, not $LOGNAME"
fi

cd /home/dave/rss-to-epub/

docker run -v /var/run/rss-to-epub:/var/run/rss-to-epub rss-to-epub

# > sudo -u www-data crontab -l
# 0 19 * * * /home/dave/rss-to-epub/run.sh 2>&1 | logger -t rss-to-epub
