docker run --rm -it --network=host \
-v $HOME/.s3cfg:/root/.s3cfg \
-e EPT_JSON=$EPT_JSON \
-e PIVOT_THREEJS=$PIVOT_THREEJS \
-e SURFACE_MAX=$SURFACE_MAX \
-e STORE_READ_URL=$STORE_READ_URL \
-e STORE_WRITE_URL=$STORE_WRITE_URL \
-e DEBUG_COLORS=$DEBUG_COLORS \
-e DEBUG=$DEBUG \
-p 3000:3000 \
pointserver2
