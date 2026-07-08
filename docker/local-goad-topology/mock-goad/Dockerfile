FROM alpine:3.19

RUN apk add --no-cache python3

COPY ad_mock.py /ad_mock.py

ENTRYPOINT ["python3", "/ad_mock.py"]
