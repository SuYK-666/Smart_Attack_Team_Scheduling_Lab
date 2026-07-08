FROM php:7.4-apache

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip iproute2 iputils-ping netcat-openbsd curl dnsutils \
    && a2enmod rewrite \
    && sed -ri -e 's!/var/www/html!/var/www/html/public!g' /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
    && rm -rf /var/lib/apt/lists/*

COPY site/ /var/www/html/
WORKDIR /var/www/html
RUN composer config --no-plugins allow-plugins.topthink/think-installer true \
    && composer install --no-dev --prefer-dist --no-interaction --no-blocking
COPY docker-entrypoint.sh /usr/local/bin/lab-entrypoint
RUN chmod +x /usr/local/bin/lab-entrypoint

ENTRYPOINT ["lab-entrypoint"]
CMD ["apache2-foreground"]
